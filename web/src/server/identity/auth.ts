import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { getStore } from "./storage";
import { addSessionCookies, clearAuthCookies, loadSession, requireAuthenticated, requireCsrf, rotateSession, saveSession, setCsrfCookie, setSessionCookie } from "./session";
import { consumeRateLimit, logAudit } from "./operations";
import { createUser, findUserByEmail, findUserByIdentifier, userResponse } from "./user-repository";
import { authorizationPath } from "./auth-flow";
import { json, empty, readJson, requireString } from "./http";
import { normalizeEmail, normalizeIdentifier, safeNextPath, validateIdentity } from "./security";
import { HttpError } from "./types";

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

    await createUser({
      email, username, firstName: String(input.firstName), lastName: String(input.lastName),
      secondLastName: typeof input.secondLastName === "string" ? input.secondLastName : "",
      passwordHash: await bcrypt.hash(String(input.password), 12), role: "USER",
    });
    await logAudit(email, "account.created", email);
    return json({ message: "Cuenta creada. Ya puedes iniciar sesión." }, 201);
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
    if (user.role === "ADMIN") {
      if (user.mfaEnabledAt && user.mfaTotpSecretEncrypted) {
        return json({ requiresMfa: true }, 200, headers);
      }
      return json({ requiresMfaSetup: true, next: "/configurar-2fa" }, 200, headers);
    }
    const next = nextContext.session.requestedAuthorization
      ? authorizationPath(nextContext.session.requestedAuthorization)
      : "/cuenta";
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
    if (!context?.user) throw new HttpError(401, "Inicia sesión para continuar.");
    const { collections } = await getStore();
    await collections.sessions.deleteOne({ _id: context.session._id });
    await logAudit(context.user.email, "account.signed_out", context.user.email);
    const headers = new Headers();
    clearAuthCookies(headers);
    return empty(204, headers);
  }

  return null;
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
