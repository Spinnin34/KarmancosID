import bcrypt from "bcryptjs";
import sharp, { type Metadata, type Sharp } from "sharp";
import { randomUUID } from "node:crypto";
import { getStore } from "./storage";
import { activeSessionFilter, addSessionCookies, clearAuthCookies, loadSession, requireAuthenticated, requireCsrf, requireAdmin } from "./session";
import { invalidateClientAuthorizations, removeGrantForClientAndPrincipal, removeGrantsForClient } from "./client-repository";
import { notifyClientOfUserLogout, revokeIdentityAccess } from "./logout";
import { consumeRateLimit, logAudit } from "./operations";
import { adminUserResponse, pictureUrl, updateUserIdentity } from "./user-repository";
import { empty, json, readFormData, readJson, requireString } from "./http";
import { normalizeEmail, randomToken, sessionReference, validateBackchannelLogoutUri, validateIdentity, validateRedirectUris, validateOrigins } from "./security";
import { HttpError, type IdentityUser, type OAuthClient } from "./types";
import { adminRecoveryEndpoint } from "./account-recovery";
import { hashPassword, verifyPassword } from "./password";
import { decryptClientSecret, encryptClientSecret } from "./client-secret";

export async function accountEndpoint(request: Request, path: string): Promise<Response | null> {
  const method = request.method.toUpperCase();
  const accountRoute = (path === "/api/account/profile" && method === "PATCH")
    || (path === "/api/account/picture" && (method === "POST" || method === "DELETE"))
    || (path === "/api/account/password" && method === "POST")
    || (path === "/api/account/sessions" && method === "GET")
    || (path === "/api/account/apps" && method === "GET")
    || (path.startsWith("/api/account/apps/") && method === "DELETE")
    || (path === "/api/account/sessions/revoke-others" && method === "POST")
    || (path.startsWith("/api/account/sessions/") && method === "DELETE");
  if (!accountRoute && !path.startsWith("/api/admin/")) return null;

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
    await revokeIdentityAccess(context.user);
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

    const form = await readFormData(request, 2 * 1024 * 1024 + 64 * 1024);
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
    const contentType = png ? "image/png" : "image/jpeg";
    const updatedAt = new Date();
    await collections.users.updateOne({ _id: context.user._id }, { $set: {
      profilePicture: processed, profilePictureContentType: contentType, profilePictureUpdatedAt: updatedAt,
    } });
    const picture = pictureUrl({
      ...context.user,
      profilePicture: processed,
      profilePictureContentType: contentType,
      profilePictureUpdatedAt: updatedAt,
    });
    await logAudit(context.user.email, "account.picture_changed", context.user._id);
    return json({ message: "Foto de perfil actualizada.", picture });
  }

  if (path === "/api/account/password" && method === "POST") {
    requireCsrf(request, context);
    requireAuthenticated(context);
    const input = await readJson(request);
    const currentPassword = requireString(input.currentPassword, "currentPassword", 128);
    const newPassword = requireString(input.newPassword, "newPassword", 128);
    if (newPassword.length < 12) throw new HttpError(400, "La contraseña debe tener entre 12 y 128 caracteres.");
    await verifyCurrentPassword(request, context.user, currentPassword);
    if (await verifyPassword(newPassword, context.user.passwordHash)) throw new HttpError(400, "Elige una contraseña distinta a la actual.");
    const { collections } = await getStore();
    await collections.users.updateOne({ _id: context.user._id }, { $set: { passwordHash: await hashPassword(newPassword) } });
    await revokeIdentityAccess(context.user);
    await logAudit(context.user.email, "account.password_changed", context.user.email);
    const headers = new Headers();
    clearAuthCookies(headers);
    return json({ message: "Contraseña actualizada. Inicia sesión con tu nueva contraseña." }, 200, headers);
  }

  if (path === "/api/account/sessions" && method === "GET") {
    requireAuthenticated(context);
    const { collections } = await getStore();
    const sessions = await collections.sessions.find({ email: normalizeEmail(context.user.email), ...activeSessionFilter() }).sort({ lastAccessedAt: -1 }).toArray();
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
    await notifyClientOfUserLogout(context.user, clientId);
    await logAudit(context.user.email, "consent.revoked", clientId);
    return empty();
  }

  const sessionMatch = path.match(/^\/api\/account\/sessions\/([^/]+)$/);
  if (sessionMatch && method === "DELETE") {
    requireCsrf(request, context);
    requireAuthenticated(context);
    const reference = decodeURIComponent(sessionMatch[1]);
    const { collections } = await getStore();
    const sessions = await collections.sessions.find({ email: normalizeEmail(context.user.email), ...activeSessionFilter() }).toArray();
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
  if (!await verifyPassword(currentPassword, user.passwordHash)) throw new HttpError(403, "La contraseña actual no es correcta.");
}

async function adminEndpoint(request: Request, path: string, context: Awaited<ReturnType<typeof loadSession>>) {
  const method = request.method.toUpperCase();
  const authorize = () => requireAdmin(context);
  requireAdmin(context);
  const { collections } = await getStore();

  if (method === "GET" && path === "/api/admin/overview") {
    authorize();
    const [accounts, clients, activeSessions] = await Promise.all([
      collections.users.countDocuments(), collections.clients.countDocuments(), collections.sessions.countDocuments(activeSessionFilter()),
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
    const backchannelLogoutUri = typeof input.backchannelLogoutUri === "string" && input.backchannelLogoutUri.trim()
      ? validateBackchannelLogoutUri(input.backchannelLogoutUri)
      : undefined;
    const clientType = typeof input.clientType === "string" ? input.clientType.toLowerCase() : "confidential";
    if (!new Set(["public", "confidential"]).has(clientType)) throw new HttpError(400, "Elige un cliente público o confidencial.");
    const clientId = `kmc_${randomToken(18)}`;
    const secret = clientType === "confidential" ? randomToken(32) : null;
    const encryptedSecret = secret ? encryptClientSecret(secret) : undefined;
    const client: OAuthClient = {
      _id: randomUUID(), clientId, clientName: name,
      ...(secret ? { clientSecret: await bcrypt.hash(secret, 12) } : {}),
      ...(encryptedSecret ? { clientSecretEncrypted: encryptedSecret } : {}),
      clientAuthenticationMethods: secret ? ["client_secret_basic"] : ["none"],
      authorizationGrantTypes: secret ? ["authorization_code", "refresh_token"] : ["authorization_code"],
      redirectUris: redirects, postLogoutRedirectUris: postLogout,
      ...(backchannelLogoutUri ? { backchannelLogoutUri } : {}),
      allowedOrigins: origins,
      scopes: ["openid", "profile", "email"], requireProofKey: true, requireAuthorizationConsent: true,
      accessTokenTimeToLive: "PT5M", refreshTokenTimeToLive: "never", reuseRefreshTokens: false,
      accessTokenFormat: "self-contained", clientIdIssuedAt: new Date(),
    };
    await collections.clients.insertOne(client);
    await logAudit(context!.user.email, "client.created", name);
    return json({ id: client._id, clientId, clientSecret: secret, note: secret ? "El secreto se guarda cifrado y se puede recuperar desde este panel." : "Este cliente público no tiene secreto." }, 201);
  }

  const clientSecretMatch = path.match(/^\/api\/admin\/clients\/([^/]+)\/secret$/);
  if (method === "POST" && clientSecretMatch) {
    requireCsrf(request, context); authorize();
    const input = await readJson(request);
    const clientId = decodeURIComponent(clientSecretMatch[1]);
    const client = await collections.clients.findOne({ _id: clientId });
    if (!client) throw new HttpError(404, "No se encontró ese sitio.");
    if (client.clientAuthenticationMethods.includes("none")) throw new HttpError(409, "Los clientes públicos no usan secreto.");

    let secret = typeof client.clientSecretEncrypted === "string" && input.rotate !== true
      ? decryptClientSecret(client.clientSecretEncrypted)
      : "";
    if (!secret) {
      secret = randomToken(32);
      const clientSecret = await bcrypt.hash(secret, 12);
      const clientSecretEncrypted = encryptClientSecret(secret);
      await collections.clients.updateOne({ _id: client._id }, { $set: { clientSecret, clientSecretEncrypted } });
      await logAudit(context!.user.email, "client.secret_rotated", client.clientName);
    } else {
      await logAudit(context!.user.email, "client.secret_viewed", client.clientName);
    }
    return json({ secret });
  }

  const editClient = path.match(/^\/api\/admin\/clients\/([^/]+)$/);
  if (method === "PATCH" && editClient) {
    requireCsrf(request, context); authorize();
    const input = await readJson(request);
    const clientId = decodeURIComponent(editClient[1]);
    const client = await collections.clients.findOne({ _id: clientId });
    if (!client) throw new HttpError(404, "No se encontró ese sitio.");
    const name = requireString(input.name, "name", 100).trim();
    const redirectUris = validateRedirectUris(input.redirectUris);
    const allowedOrigins = validateOrigins(input.allowedOrigins);
    const postLogoutRedirectUris = input.postLogoutRedirectUris == null
      || (Array.isArray(input.postLogoutRedirectUris) && input.postLogoutRedirectUris.length === 0)
      ? []
      : validateRedirectUris(input.postLogoutRedirectUris);
    const rawBackchannelLogoutUri = typeof input.backchannelLogoutUri === "string" ? input.backchannelLogoutUri.trim() : "";
    const currentClientType = client.clientAuthenticationMethods.includes("none") ? "public" : "confidential";
    const nextClientType = input.clientType == null ? currentClientType : input.clientType;
    if (nextClientType !== "public" && nextClientType !== "confidential") {
      throw new HttpError(400, "Elige un cliente público o confidencial.");
    }
    const clientTypeChanged = nextClientType !== currentClientType;
    const newSecret = clientTypeChanged && nextClientType === "confidential" ? randomToken(32) : undefined;
    const update = {
      clientName: name,
      redirectUris,
      allowedOrigins,
      postLogoutRedirectUris,
      ...(rawBackchannelLogoutUri ? { backchannelLogoutUri: validateBackchannelLogoutUri(rawBackchannelLogoutUri) } : {}),
      ...(clientTypeChanged ? {
        clientAuthenticationMethods: nextClientType === "public" ? ["none"] : ["client_secret_basic"],
        authorizationGrantTypes: nextClientType === "public" ? ["authorization_code"] : ["authorization_code", "refresh_token"],
        requireProofKey: true,
      } : {}),
      ...(newSecret ? {
        clientSecret: await bcrypt.hash(newSecret, 12),
        clientSecretEncrypted: encryptClientSecret(newSecret),
      } : {}),
    };
    const unset: Record<string, ""> = {};
    if (!rawBackchannelLogoutUri) unset.backchannelLogoutUri = "";
    if (clientTypeChanged && nextClientType === "public") {
      unset.clientSecret = "";
      unset.clientSecretEncrypted = "";
    }
    await collections.clients.updateOne(
      { _id: client._id },
      { $set: update, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
    );
    if (clientTypeChanged) await invalidateClientAuthorizations(client._id);
    await logAudit(context!.user.email, clientTypeChanged ? "client.type_changed" : "client.updated", name);
    return json({ message: "Datos del sitio actualizados.", clientType: nextClientType, secretAvailable: nextClientType === "confidential" });
  }

  const backchannelLogoutMatch = path.match(/^\/api\/admin\/clients\/([^/]+)\/backchannel-logout$/);
  if (method === "PATCH" && backchannelLogoutMatch) {
    requireCsrf(request, context); authorize();
    const input = await readJson(request);
    const uri = typeof input.uri === "string" ? input.uri.trim() : "";
    const backchannelLogoutUri = uri ? validateBackchannelLogoutUri(uri) : "";
    const clientId = decodeURIComponent(backchannelLogoutMatch[1]);
    const client = await collections.clients.findOne({ _id: clientId });
    if (!client) throw new HttpError(404, "No se encontró ese cliente.");
    if (backchannelLogoutUri) {
      await collections.clients.updateOne({ _id: client._id }, { $set: { backchannelLogoutUri } });
    } else {
      await collections.clients.updateOne({ _id: client._id }, { $unset: { backchannelLogoutUri: "" } });
    }
    await logAudit(context!.user.email, "client.backchannel_logout_updated", client.clientName);
    return json({ message: "Endpoint de cierre de sesión actualizado." });
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
    if (accessChanged) await revokeIdentityAccess(user);
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
    const updated = await updateUserIdentity(user, {
      email: String(input.email), username: String(input.username), firstName: String(input.firstName),
      lastName: String(input.lastName), secondLastName: typeof input.secondLastName === "string" ? input.secondLastName : "",
    });
    if (!updated) throw new HttpError(404, "No se encontró esa cuenta.");
    await revokeIdentityAccess(user);
    await logAudit(context!.user.email, "account.profile_admin_changed", updated.email);
    return json(adminUserResponse(updated));
  }

  if (method === "GET" && path === "/api/admin/sessions") {
    authorize();
    const sessions = await collections.sessions.find(activeSessionFilter()).sort({ lastAccessedAt: -1 }).limit(50).toArray();
    return json(sessions.map((session) => ({
      reference: sessionReference(session._id), email: session.email || "", createdAt: session.createdAt, lastAccessedAt: session.lastAccessedAt,
    })));
  }

  const adminSessionMatch = path.match(/^\/api\/admin\/sessions\/([^/]+)$/);
  if (method === "DELETE" && adminSessionMatch) {
    requireCsrf(request, context); authorize();
    const reference = decodeURIComponent(adminSessionMatch[1]);
    const sessions = await collections.sessions.find(activeSessionFilter()).toArray();
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
    backchannelLogoutUri: client.backchannelLogoutUri ?? "",
    scopes: client.scopes ?? [],
    secretAvailable: Boolean(client.clientSecretEncrypted),
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
    backchannelLogoutUri: typeof application.backchannelLogoutUri === "string" ? application.backchannelLogoutUri : "",
    status: application.status,
    submittedAt: application.submittedAt,
    reviewedAt: application.reviewedAt ?? null,
  };
}
