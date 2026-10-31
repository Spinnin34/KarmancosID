import bcrypt from "bcryptjs";
import sharp, { type Metadata, type Sharp } from "sharp";
import { randomUUID } from "node:crypto";
import { getStore } from "./storage";
import { addSessionCookies, clearAuthCookies, loadSession, requireAuthenticated, requireCsrf, requireAdmin } from "./session";
import { removeGrantForClientAndPrincipal, removeGrantsForClient, removeGrantsForPrincipal } from "./client-repository";
import { consumeRateLimit, logAudit } from "./operations";
import { adminUserResponse, pictureUrl, updateUserIdentity } from "./user-repository";
import { empty, json, readJson, requireString } from "./http";
import { normalizeEmail, randomToken, sessionReference, validateIdentity, validateRedirectUris, validateOrigins } from "./security";
import { HttpError, type IdentityUser, type OAuthClient } from "./types";
import { adminRecoveryEndpoint } from "./account-recovery";

export async function accountEndpoint(request: Request, path: string): Promise<Response | null> {
  const method = request.method.toUpperCase();
  const context = await loadSession(request);

  if (path === "/api/account/profile" && method === "PATCH") {
    requireCsrf(request, context);
    requireAuthenticated(context);
    const input = await readJson(request);
    const validation = validateIdentity(input, false);
    if (validation) throw new HttpError(400, validation);
    const currentPassword = requireString(input.currentPassword, "currentPassword", 128);
    await verifyCurrentPassword(request, context.user, currentPassword);
    const previousEmail = context.user.email;
    const updated = await updateUserIdentity(context.user, {
      email: String(input.email), username: String(input.username), firstName: String(input.firstName),
      lastName: String(input.lastName), secondLastName: typeof input.secondLastName === "string" ? input.secondLastName : "",
    });
    if (!updated) throw new HttpError(404, "No se encontró esa cuenta.");
    await revokeIdentityAccess(previousEmail);
    await logAudit(previousEmail, "account.profile_changed", updated.email);
    const headers = new Headers();
    clearAuthCookies(headers);
    return json({ message: "Cambios guardados. Inicia sesión de nuevo para continuar." }, 200, headers);
  }

  if (path === "/api/account/picture" && (method === "POST" || method === "DELETE")) {
    requireCsrf(request, context);
    requireAuthenticated(context);
    const rate = await consumeRateLimit(request, "account-picture", context.user._id, 8, 60 * 60_000);
    if (!rate.allowed) throw new HttpError(429, "Has cambiado la foto varias veces. Prueba de nuevo más tarde.");
    const { collections } = await getStore();
    if (method === "DELETE") {
      await collections.users.updateOne({ _id: context.user._id }, { $unset: { profilePicture: "", profilePictureContentType: "", profilePictureUpdatedAt: "" } });
      if (context.user.profilePicture) await logAudit(context.user.email, "account.picture_removed", context.user._id);
      return json({ message: "Foto de perfil eliminada.", picture: null });
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size < 1) throw new HttpError(400, "Selecciona una imagen para tu foto de perfil.");
    if (file.size > 2 * 1024 * 1024) throw new HttpError(413, "La imagen no puede superar los 2 MB.");
    const inputBuffer = Buffer.from(await file.arrayBuffer());
    let image: Sharp;
    try { image = sharp(inputBuffer, { failOn: "error", limitInputPixels: 12_000_000 }); }
    catch { throw new HttpError(400, "Usa una imagen JPG o PNG válida."); }
    let metadata: Metadata;
    try { metadata = await image.metadata(); } catch { throw new HttpError(400, "Usa una imagen JPG o PNG válida."); }
    if (!metadata.width || !metadata.height || metadata.width > 4096 || metadata.height > 4096 || metadata.width * metadata.height > 12_000_000) {
      throw new HttpError(400, "La imagen debe medir como máximo 4096 × 4096 píxeles.");
    }
    if (metadata.format !== "jpeg" && metadata.format !== "png") throw new HttpError(400, "Solo se admiten imágenes JPG o PNG.");
    const png = metadata.format === "png";
    let processed: Buffer;
    try {
      image = image.rotate().resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true });
      processed = png ? await image.png({ compressionLevel: 9, palette: true }).toBuffer() : await image.jpeg({ quality: 88, mozjpeg: true }).toBuffer();
    } catch { throw new HttpError(400, "No se pudo procesar la imagen seleccionada."); }
    await collections.users.updateOne({ _id: context.user._id }, { $set: {
      profilePicture: processed, profilePictureContentType: png ? "image/png" : "image/jpeg", profilePictureUpdatedAt: new Date(),
    } });
    const updated = await collections.users.findOne({ _id: context.user._id });
    if (!updated) throw new HttpError(404, "No se encontró esa cuenta.");
    await logAudit(context.user.email, "account.picture_changed", context.user._id);
    return json({ message: "Foto de perfil actualizada.", picture: pictureUrl(updated) });
  }

  if (path === "/api/account/password" && method === "POST") {
    requireCsrf(request, context);
    requireAuthenticated(context);
    const input = await readJson(request);
    const currentPassword = requireString(input.currentPassword, "currentPassword", 128);
    const newPassword = requireString(input.newPassword, "newPassword", 128);
    if (newPassword.length < 12) throw new HttpError(400, "La contraseña debe tener entre 12 y 128 caracteres.");
    await verifyCurrentPassword(request, context.user, currentPassword);
    if (await bcrypt.compare(newPassword, context.user.passwordHash)) throw new HttpError(400, "Elige una contraseña distinta a la actual.");
    const { collections } = await getStore();
    await collections.users.updateOne({ _id: context.user._id }, { $set: { passwordHash: await bcrypt.hash(newPassword, 12) } });
    await revokeIdentityAccess(context.user.email);
    await logAudit(context.user.email, "account.password_changed", context.user.email);
    const headers = new Headers();
    clearAuthCookies(headers);
    return json({ message: "Contraseña actualizada. Inicia sesión con tu nueva contraseña." }, 200, headers);
  }

  if (path === "/api/account/sessions" && method === "GET") {
    requireAuthenticated(context);
    const { collections } = await getStore();
    const sessions = await collections.sessions.find({ email: normalizeEmail(context.user.email), expiresAt: { $gt: new Date() } }).sort({ lastAccessedAt: -1 }).toArray();
    const headers = new Headers();
    addSessionCookies(headers, context);
    return json(sessions.map((session) => ({
      reference: sessionReference(session._id), current: session._id === context.session._id,
      createdAt: session.createdAt, lastAccessedAt: session.lastAccessedAt,
    })), 200, headers);
  }

  if (path === "/api/account/apps" && method === "GET") {
    requireAuthenticated(context);
    const { collections } = await getStore();
    const docs = await collections.consents.find({ principalName: normalizeEmail(context.user.email) }).toArray();
    const clients = await Promise.all(docs.map((doc) => collections.clients.findOne({ _id: doc.registeredClientId })));
    const list = docs.flatMap((doc, index) => {
      const client = clients[index];
      if (!client) return [];
      return [{ id: String(doc.registeredClientId), name: client.clientName, scopes: (doc.authorities ?? []).map((item: string) => item.replace(/^SCOPE_/, "")) }];
    });
    const headers = new Headers();
    addSessionCookies(headers, context);
    return json(list, 200, headers);
  }

  const appMatch = path.match(/^\/api\/account\/apps\/([^/]+)$/);
  if (appMatch && method === "DELETE") {
    requireCsrf(request, context);
    requireAuthenticated(context);
    const clientId = decodeURIComponent(appMatch[1]);
    const { collections } = await getStore();
    const consent = await collections.consents.findOne({ registeredClientId: clientId, principalName: normalizeEmail(context.user.email) });
    if (!consent) throw new HttpError(404, "No existe un permiso para esa aplicación.");
    await removeGrantForClientAndPrincipal(clientId, context.user.email);
    await logAudit(context.user.email, "consent.revoked", clientId);
    return empty();
  }

  const sessionMatch = path.match(/^\/api\/account\/sessions\/([^/]+)$/);
  if (sessionMatch && method === "DELETE") {
    requireCsrf(request, context);
    requireAuthenticated(context);
    const reference = decodeURIComponent(sessionMatch[1]);
    const { collections } = await getStore();
    const sessions = await collections.sessions.find({ email: normalizeEmail(context.user.email), expiresAt: { $gt: new Date() } }).toArray();
    const selected = sessions.find((item) => sessionReference(item._id) === reference);
    if (!selected) throw new HttpError(404, "La sesión ya no existe.");
    if (selected._id === context.session._id) throw new HttpError(409, "Usa Cerrar sesión para terminar la sesión actual.");
    await collections.sessions.deleteOne({ _id: selected._id });
    await logAudit(context.user.email, "session.revoked", reference);
    return empty();
  }

  if (path === "/api/account/sessions/revoke-others" && method === "POST") {
    requireCsrf(request, context);
    requireAuthenticated(context);
    const { collections } = await getStore();
    await collections.sessions.deleteMany({ email: normalizeEmail(context.user.email), _id: { $ne: context.session._id } });
    await logAudit(context.user.email, "sessions.others_revoked", context.user.email);
    return json({ message: "Se cerraron las otras sesiones." });
  }

  if (path.startsWith("/api/admin/users/") && path.endsWith("/recovery-code")) {
    const response = await adminRecoveryEndpoint(request, path, context);
    if (response) return response;
  }
  if (path.startsWith("/api/admin/")) return adminEndpoint(request, path, context);
  return null;
}

async function verifyCurrentPassword(request: Request, user: IdentityUser, currentPassword: string) {
  const rate = await consumeRateLimit(request, "account-change", user._id, 5, 15 * 60_000);
  if (!rate.allowed) throw new HttpError(429, "Has alcanzado el límite de cambios. Prueba más tarde.");
  if (!await bcrypt.compare(currentPassword, user.passwordHash)) throw new HttpError(403, "La contraseña actual no es correcta.");
}

async function revokeIdentityAccess(email: string) {
  const { collections } = await getStore();
  await collections.sessions.deleteMany({ email: normalizeEmail(email) });
  await removeGrantsForPrincipal(email);
}

async function adminEndpoint(request: Request, path: string, context: Awaited<ReturnType<typeof loadSession>>) {
  const method = request.method.toUpperCase();
  const authorize = () => requireAdmin(context);
  requireAdmin(context);
  const { collections } = await getStore();

  if (method === "GET" && path === "/api/admin/overview") {
    authorize();
    const [accounts, clients, activeSessions] = await Promise.all([
      collections.users.countDocuments(), collections.clients.countDocuments(), collections.sessions.countDocuments({ expiresAt: { $gt: new Date() } }),
    ]);
    return json({ accounts, clients, activeSessions });
  }

  if (method === "GET" && path === "/api/admin/clients") {
    authorize();
    const clients = await collections.clients.find().sort({ clientIdIssuedAt: -1 }).toArray();
    return json(clients.map(clientView));
  }

  if (method === "POST" && path === "/api/admin/clients") {
    requireCsrf(request, context); authorize();
    const input = await readJson(request);
    const name = requireString(input.name, "name", 100).trim();
    const redirects = validateRedirectUris(input.redirectUris);
    const origins = validateOrigins(input.allowedOrigins);
    const postLogout = input.postLogoutRedirectUris == null
      || (Array.isArray(input.postLogoutRedirectUris) && input.postLogoutRedirectUris.length === 0)
      ? []
      : validateRedirectUris(input.postLogoutRedirectUris);
    const clientType = typeof input.clientType === "string" ? input.clientType.toLowerCase() : "confidential";
    if (!new Set(["public", "confidential"]).has(clientType)) throw new HttpError(400, "Elige un cliente público o confidencial.");
    const clientId = `kmc_${randomToken(18)}`;
    const secret = clientType === "confidential" ? randomToken(32) : null;
    const client: OAuthClient = {
      _id: randomUUID(), clientId, clientName: name,
      ...(secret ? { clientSecret: await bcrypt.hash(secret, 12) } : {}),
      clientAuthenticationMethods: secret ? ["client_secret_basic"] : ["none"],
      authorizationGrantTypes: secret ? ["authorization_code", "refresh_token"] : ["authorization_code"],
      redirectUris: redirects, postLogoutRedirectUris: postLogout, allowedOrigins: origins,
      scopes: ["openid", "profile", "email"], requireProofKey: true, requireAuthorizationConsent: true,
      accessTokenTimeToLive: "PT5M", refreshTokenTimeToLive: "P30D", reuseRefreshTokens: false,
      accessTokenFormat: "self-contained", clientIdIssuedAt: new Date(),
    };
    await collections.clients.insertOne(client);
    await logAudit(context!.user.email, "client.created", name);
    return json({ clientId, clientSecret: secret, note: "Guarda el secreto ahora. No volverá a mostrarse." }, 201);
  }

  const deleteClient = path.match(/^\/api\/admin\/clients\/([^/]+)$/);
  if (method === "DELETE" && deleteClient) {
    requireCsrf(request, context); authorize();
    const { collections: store } = await getStore();
    const client = await store.clients.findOne({ _id: decodeURIComponent(deleteClient[1]) });
    if (!client) throw new HttpError(404, "No se encontró ese cliente.");
    await removeGrantsForClient(client._id);
    await store.clients.deleteOne({ _id: client._id });
    await logAudit(context!.user.email, "client.deleted", client.clientName);
    return empty();
  }

  if (method === "GET" && path === "/api/admin/users") {
    authorize();
    const users = await collections.users.find().sort({ createdAt: -1 }).toArray();
    return json(users.map(adminUserResponse));
  }

  const accessMatch = path.match(/^\/api\/admin\/users\/([^/]+)\/access$/);
  if (method === "PATCH" && accessMatch) {
    requireCsrf(request, context); authorize();
    const input = await readJson(request);
    const user = await collections.users.findOne({ _id: decodeURIComponent(accessMatch[1]) });
    if (!user) throw new HttpError(404, "No se encontró esa cuenta.");
    if (input.active == null && input.role == null) throw new HttpError(400, "Elige un cambio de acceso.");
    const active = input.active == null ? user.active : Boolean(input.active);
    const role = input.role == null ? user.role : String(input.role).toUpperCase();
    if (role !== "USER" && role !== "ADMIN") throw new HttpError(400, "El rol debe ser USER o ADMIN.");
    if (user.email.toLowerCase() === context!.user.email.toLowerCase() && (!active || role !== "ADMIN")) throw new HttpError(409, "No puedes quitarte tu propio acceso de administrador.");
    if (user.role === "ADMIN" && role !== "ADMIN" && await collections.users.countDocuments({ role: "ADMIN" }) <= 1) throw new HttpError(409, "Debe quedar al menos una cuenta administradora.");
    const accessChanged = active !== user.active || role !== user.role;
    await collections.users.updateOne({ _id: user._id }, { $set: { active, role } });
    if (accessChanged) await revokeIdentityAccess(user.email);
    await logAudit(context!.user.email, "account.access_changed", user.email);
    return json(adminUserResponse({ ...user, active, role: role as IdentityUser["role"] }));
  }

  const profileMatch = path.match(/^\/api\/admin\/users\/([^/]+)\/profile$/);
  if (method === "PATCH" && profileMatch) {
    requireCsrf(request, context); authorize();
    const input = await readJson(request);
    const validation = validateIdentity(input, false);
    if (validation) throw new HttpError(400, validation);
    const user = await collections.users.findOne({ _id: decodeURIComponent(profileMatch[1]) });
    if (!user) throw new HttpError(404, "No se encontró esa cuenta.");
    if (user.email.toLowerCase() === context!.user.email.toLowerCase()) throw new HttpError(409, "Edita tu propia identidad desde Mi cuenta para confirmar el cambio con tu contraseña.");
    const previousEmail = user.email;
    const updated = await updateUserIdentity(user, {
      email: String(input.email), username: String(input.username), firstName: String(input.firstName),
      lastName: String(input.lastName), secondLastName: typeof input.secondLastName === "string" ? input.secondLastName : "",
    });
    if (!updated) throw new HttpError(404, "No se encontró esa cuenta.");
    await revokeIdentityAccess(previousEmail);
    await logAudit(context!.user.email, "account.profile_admin_changed", updated.email);
    return json(adminUserResponse(updated));
  }

  if (method === "GET" && path === "/api/admin/sessions") {
    authorize();
    const sessions = await collections.sessions.find({ expiresAt: { $gt: new Date() } }).sort({ lastAccessedAt: -1 }).limit(50).toArray();
    return json(sessions.map((session) => ({
      reference: sessionReference(session._id), email: session.email || "", createdAt: session.createdAt, lastAccessedAt: session.lastAccessedAt,
    })));
  }

  const adminSessionMatch = path.match(/^\/api\/admin\/sessions\/([^/]+)$/);
  if (method === "DELETE" && adminSessionMatch) {
    requireCsrf(request, context); authorize();
    const reference = decodeURIComponent(adminSessionMatch[1]);
    const sessions = await collections.sessions.find({ expiresAt: { $gt: new Date() } }).toArray();
    const target = sessions.find((session) => sessionReference(session._id) === reference);
    if (!target) throw new HttpError(404, "La sesión ya no existe.");
    await collections.sessions.deleteOne({ _id: target._id });
    await logAudit(context!.user.email, "session.revoked", target.email || reference);
    return empty();
  }

  if (method === "GET" && path === "/api/admin/activity") {
    authorize();
    const events = await collections.audit.find().sort({ occurredAt: -1 }).limit(20).toArray();
    return json(events.map((event) => ({ id: event._id, actor: event.actorEmail, action: event.action, subject: event.subject, occurredAt: event.occurredAt })));
  }

  if (method === "GET" && path === "/api/admin/applications") {
    authorize();
    const applications = await collections.applications.find().sort({ submittedAt: -1 }).toArray();
    return json(applications.map(applicationView));
  }

  const reviewMatch = path.match(/^\/api\/admin\/applications\/([^/]+)$/);
  if (method === "PATCH" && reviewMatch) {
    requireCsrf(request, context); authorize();
    const input = await readJson(request);
    const status = String(input.status ?? "").toUpperCase();
    if (status !== "APPROVED" && status !== "REJECTED") throw new HttpError(400, "Estado inválido.");
    const application = await collections.applications.findOneAndUpdate(
      { _id: decodeURIComponent(reviewMatch[1]), status: "PENDING" },
      { $set: { status, reviewedAt: new Date() } },
      { returnDocument: "after" },
    );
    if (!application) {
      const exists = await collections.applications.findOne({ _id: decodeURIComponent(reviewMatch[1]) });
      if (!exists) throw new HttpError(404, "No se encontró la solicitud.");
      throw new HttpError(409, "La solicitud ya se revisó.");
    }
    await logAudit(context!.user.email, `client.application_${status.toLowerCase()}`, application.name ?? "Solicitud de integración");
    return json(applicationView(application));
  }

  return null;
}

function clientView(client: OAuthClient) {
  return {
    id: client._id,
    clientId: client.clientId,
    name: client.clientName,
    clientType: client.clientAuthenticationMethods.includes("none") ? "public" : "confidential",
    redirectUris: client.redirectUris ?? [],
    allowedOrigins: client.allowedOrigins ?? [],
    postLogoutRedirectUris: client.postLogoutRedirectUris ?? [],
    scopes: client.scopes ?? [],
    createdAt: client.clientIdIssuedAt,
  };
}

function applicationView(application: Record<string, unknown>) {
  return {
    id: application._id,
    name: application.name,
    contactEmail: application.contactEmail,
    description: application.description,
    clientType: application.clientType,
    redirectUris: application.redirectUris ?? [],
    postLogoutRedirectUris: application.postLogoutRedirectUris ?? [],
    status: application.status,
    submittedAt: application.submittedAt,
    reviewedAt: application.reviewedAt ?? null,
  };
}
