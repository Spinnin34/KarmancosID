import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { getStore } from "./storage";
import { addSessionCookies, clearAuthCookies, loadSession, requireAuthenticated, requireCsrf, rotateSession, saveSession, setCsrfCookie, setSessionCookie } from "./session";
import { consumeActionToken, sendActionEmail } from "./email";
import { consumeRateLimit, findUserByEmail, findUserByIdentifier, logAudit, removeGrantsForPrincipal, userResponse, createUser } from "./common";
import { json, empty, clientIp, readJson, requireString } from "./http";
import { normalizeEmail, normalizeIdentifier, safeNextPath, validateIdentity } from "./security";
import { HttpError, type AuthorizationRequest, type IdentityUser } from "./types";

export async function authEndpoint(request: Request, path: string): Promise<Response | null> {
  const method = request.method.toUpperCase();

  if (path === "/api/auth/csrf" && method === "GET") {
    const context = await loadSession(request, true);
    if (!context) throw new Error("Could not create identity session.");
    const headers = new Headers();
    addSessionCookies(headers, context);
    return json({ token: context.session.csrfToken, headerName: "X-XSRF-TOKEN" }, 200, headers);
  }

  if (path === "/api/auth/continue" && method === "GET") {
    const context = await loadSession(request);
    const pending = context?.session.requestedAuthorization;
    if (!pending) return json({ requested: false, name: "", domain: "" });
    const { collections } = await getStore();
    const client = await collections.clients.findOne({ clientId: pending.clientId });
    if (!client) return json({ requested: false, name: "", domain: "" });
    const domain = (() => { try { return new URL(client.redirectUris[0]).hostname; } catch { return ""; } })();
    const headers = new Headers();
    if (context) addSessionCookies(headers, context);
    return json({ requested: true, name: client.clientName, domain }, 200, headers);
  }

  if (path === "/api/auth/register" && method === "POST") {
    const session = await loadSession(request);
    requireCsrf(request, session);
    const input = await readJson(request);
    const validation = validateIdentity(input);
    if (validation) throw new HttpError(400, validation);
    const email = normalizeEmail(String(input.email));
    const username = normalizeIdentifier(String(input.username));
    const rate = await consumeRateLimit(request, "register", email, 4, 60 * 60_000);
    if (!rate.allowed) throw new HttpError(429, "Has alcanzado el límite de registros. Prueba más tarde.");

    const existing = await findUserByEmail(email);
    const { collections } = await getStore();
    const byUsername = await collections.users.findOne({ username });
    if (existing || byUsername) throw new HttpError(409, "No se pudo crear la cuenta con esos datos.");

    const user = await createUser({
      email, username, firstName: String(input.firstName), lastName: String(input.lastName),
      secondLastName: typeof input.secondLastName === "string" ? input.secondLastName : "",
      passwordHash: await bcrypt.hash(String(input.password), 12), role: "USER",
    });
    await sendActionEmail(user, "verify");
    await logAudit(email, "account.created", email);
    return json({ message: "Cuenta creada. Revisa tu correo para verificar la dirección." }, 201);
  }

  if (path === "/api/auth/login" && method === "POST") {
    const context = await loadSession(request);
    requireCsrf(request, context);
    const input = await readJson(request);
    const identifier = normalizeIdentifier(String(input.identifier ?? input.email ?? ""));
    const password = requireString(input.password, "password", 128);
    const rate = await consumeRateLimit(request, "login", identifier, 6, 15 * 60_000);
    if (!rate.allowed) {
      return json({ message: "Demasiados intentos. Espera un poco antes de volver a probar." }, 429, { "Retry-After": String(rate.retryAfterSeconds) });
    }

    const user = await findUserByIdentifier(identifier);
    if (!user || !user.active || !await bcrypt.compare(password, user.passwordHash)) {
      throw new HttpError(401, "El usuario o la contraseña no son correctos.");
    }

    const current = context ?? await loadSession(request, true);
    if (!current) throw new Error("Could not create identity session.");
    const nextContext = await rotateSession(request, current, user);
    await saveSession(nextContext);
    const headers = new Headers();
    setSessionCookie(headers, nextContext.session._id);
    setCsrfCookie(headers, nextContext.session.csrfToken);
    const next = nextContext.session.requestedAuthorization
      ? authorizationPath(nextContext.session.requestedAuthorization)
      : user.role === "ADMIN" ? "/admin" : "/cuenta";
    await logAudit(user.email, "account.signed_in", user.email);
    return json({ next: safeNextPath(next) }, 200, headers);
  }

  if (path === "/api/auth/me" && method === "GET") {
    const context = await loadSession(request);
    requireAuthenticated(context);
    const headers = new Headers();
    addSessionCookies(headers, context);
    return json(userResponse(context.user), 200, headers);
  }

  if (path === "/api/auth/logout" && method === "POST") {
    const context = await loadSession(request);
    requireCsrf(request, context);
    requireAuthenticated(context);
    const { collections } = await getStore();
    await collections.sessions.deleteOne({ _id: context.session._id });
    await logAudit(context.user.email, "account.signed_out", context.user.email);
    const headers = new Headers();
    clearAuthCookies(headers);
    return empty(204, headers);
  }

  if (path === "/api/auth/email/verify" && method === "POST") {
    const context = await loadSession(request);
    requireCsrf(request, context);
    const input = await readJson(request);
    const rawToken = requireString(input.token, "token", 100);
    const token = await consumeActionToken(rawToken, "verify");
    if (!token) throw new HttpError(400, "El enlace ha caducado o ya se ha usado.");
    const { collections } = await getStore();
    const user = await collections.users.findOne({ _id: token.userId });
    if (!user || normalizeEmail(user.email) !== normalizeEmail(token.targetEmail)) throw new HttpError(400, "El enlace ha caducado o ya se ha usado.");
    await collections.users.updateOne({ _id: user._id }, { $set: { emailVerified: true } });
    await logAudit(user.email, "account.email_verified", user.email);
    return json({ message: "Correo electrónico verificado." });
  }

  if (path === "/api/auth/email/resend" && method === "POST") {
    const context = await loadSession(request);
    requireCsrf(request, context);
    const input = await readJson(request);
    const email = normalizeEmail(requireString(input.email, "email", 320));
    const rate = await consumeRateLimit(request, "email-verify", email, 3, 60 * 60_000);
    if (!rate.allowed) return json({ message: "Espera antes de volver a solicitar un correo." }, 429);
    const user = await findUserByEmail(email);
    if (user?.active && !user.emailVerified) await sendActionEmail(user, "verify");
    return json({ message: "Si la cuenta existe y necesita verificación, enviaremos un enlace al correo indicado." }, 202);
  }

  if (path === "/api/auth/password/reset-request" && method === "POST") {
    const context = await loadSession(request);
    requireCsrf(request, context);
    const input = await readJson(request);
    const email = normalizeEmail(requireString(input.email, "email", 320));
    const rate = await consumeRateLimit(request, "password-reset", email, 4, 60 * 60_000);
    if (!rate.allowed) return json({ message: "Espera antes de volver a solicitar una recuperación." }, 429);
    const user = await findUserByEmail(email);
    if (user) await sendActionEmail(user, "reset");
    return json({ message: "Si existe una cuenta para ese correo, recibirás instrucciones para restablecer la contraseña." }, 202);
  }

  if (path === "/api/auth/password/reset" && method === "POST") {
    const context = await loadSession(request);
    requireCsrf(request, context);
    const input = await readJson(request);
    const tokenValue = requireString(input.token, "token", 100);
    const password = requireString(input.newPassword, "newPassword", 128);
    if (password.length < 12) throw new HttpError(400, "La contraseña debe tener entre 12 y 128 caracteres.");
    const token = await consumeActionToken(tokenValue, "reset");
    if (!token) throw new HttpError(400, "El enlace ha caducado o ya se ha usado.");
    const { collections } = await getStore();
    const user = await collections.users.findOne({ _id: token.userId });
    if (!user || normalizeEmail(user.email) !== normalizeEmail(token.targetEmail)) throw new HttpError(400, "El enlace ha caducado o ya se ha usado.");
    await collections.users.updateOne({ _id: user._id }, { $set: { passwordHash: await bcrypt.hash(password, 12) } });
    await collections.sessions.deleteMany({ email: normalizeEmail(user.email) });
    await removeGrantsForPrincipal(user.email);
    await logAudit(user.email, "account.password_reset", user._id);
    return json({ message: "Contraseña actualizada. Ya puedes iniciar sesión." });
  }

  return null;
}

function authorizationPath(request: AuthorizationRequest) {
  const params = new URLSearchParams({
    client_id: request.clientId,
    redirect_uri: request.redirectUri,
    response_type: request.responseType,
    scope: request.scopes.join(" "),
    state: request.state,
    code_challenge: request.codeChallenge,
    code_challenge_method: request.codeChallengeMethod,
  });
  if (request.nonce) params.set("nonce", request.nonce);
  return `/oauth2/authorize?${params.toString()}`;
}

export async function bootstrapAdmin() {
  const email = process.env.KARMANCOS_BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.KARMANCOS_BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !password) return;
  if (password.length < 16) throw new Error("Bootstrap administrator password must contain at least 16 characters.");
  const { collections } = await getStore();
  if (await collections.users.findOne({ email })) return;
  let username = email.split("@", 1)[0].replace(/[^a-z0-9._-]/g, "_").slice(0, 24);
  if (username.length < 3) username = "admin";
  while (await collections.users.findOne({ username })) username = `${username.slice(0, 24)}_${randomUUID().replaceAll("-", "").slice(0, 6)}`;
  try {
    const user = await createUser({
      email, username, firstName: "Administrador", lastName: "", secondLastName: "",
      passwordHash: await bcrypt.hash(password, 12), role: "ADMIN",
    });
    await logAudit(email, "account.bootstrap_admin_created", user._id);
  } catch (error) {
    // Multiple cold starts may race to create the first administrator.
    if (!(error instanceof HttpError && error.status === 409)) throw error;
  }
}
