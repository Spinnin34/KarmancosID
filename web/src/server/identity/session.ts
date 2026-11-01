import { randomToken, secureEqual } from "./security";
import { HttpError, type IdentitySession, type IdentityUser } from "./types";
import { getStore } from "./storage";
import { appendCookie } from "./http";

const SESSION_SECONDS = 30 * 60;
const SESSION_COOKIE = process.env.KARMANCOS_SESSION_COOKIE_NAME || "KARMANCOSID";
const secureCookie = process.env.KARMANCOS_SECURE_COOKIES !== "false";

export interface SessionContext {
  session: IdentitySession;
  user: IdentityUser | null;
  isNew: boolean;
}

const requestSessions = new WeakMap<Request, SessionContext | null>();

export function sessionForRequest(request: Request): SessionContext | null {
  return requestSessions.get(request) ?? null;
}

function rememberSession(request: Request, context: SessionContext | null): SessionContext | null {
  requestSessions.set(request, context);
  return context;
}

export function cookies(request: Request): Map<string, string> {
  const result = new Map<string, string>();
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const split = part.indexOf("=");
    if (split < 1) continue;
    const key = part.slice(0, split).trim();
    const raw = part.slice(split + 1).trim();
    try { result.set(key, decodeURIComponent(raw)); } catch { result.set(key, raw); }
  }
  return result;
}

function cookie(name: string, value: string, options: { httpOnly?: boolean; maxAge?: number; clear?: boolean } = {}) {
  const parts = [`${name}=${options.clear ? "" : encodeURIComponent(value)}`, "Path=/", "SameSite=Lax"];
  if (options.httpOnly) parts.push("HttpOnly");
  if (secureCookie) parts.push("Secure");
  parts.push(`Max-Age=${options.clear ? 0 : options.maxAge ?? SESSION_SECONDS}`);
  return parts.join("; ");
}

export function setSessionCookie(headers: Headers, sid: string) {
  appendCookie(headers, cookie(SESSION_COOKIE, sid, { httpOnly: true }));
}

export function setCsrfCookie(headers: Headers, token: string) {
  appendCookie(headers, cookie("XSRF-TOKEN", token));
}

export function clearAuthCookies(headers: Headers) {
  appendCookie(headers, cookie(SESSION_COOKIE, "", { httpOnly: true, clear: true }));
  appendCookie(headers, cookie("XSRF-TOKEN", "", { clear: true }));
}

export async function loadSession(request: Request, create = false): Promise<SessionContext | null> {
  const sid = cookies(request).get(SESSION_COOKIE);
  const { collections } = await getStore();
  let session = sid
    ? await collections.sessions.findOne({ _id: sid, expiresAt: { $gt: new Date() } })
    : null;
  let isNew = false;

  if (session && session.userId) {
    const user = await collections.users.findOne({ _id: session.userId, active: true });
    if (!user) {
      await collections.sessions.deleteOne({ _id: session._id });
      session = null;
    } else {
      await collections.sessions.updateOne({ _id: session._id }, {
        $set: { lastAccessedAt: new Date(), expiresAt: new Date(Date.now() + SESSION_SECONDS * 1000) },
      });
      session.lastAccessedAt = new Date();
      session.expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000);
      return rememberSession(request, { session, user, isNew });
    }
  }

  if (session) {
    await collections.sessions.updateOne({ _id: session._id }, {
      $set: { lastAccessedAt: new Date(), expiresAt: new Date(Date.now() + SESSION_SECONDS * 1000) },
    });
    session.lastAccessedAt = new Date();
    session.expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000);
    return rememberSession(request, { session, user: null, isNew });
  }

  if (!create) return rememberSession(request, null);
  const now = new Date();
  const created: IdentitySession = {
    _id: randomToken(32),
    userId: null,
    email: null,
    csrfToken: randomToken(32),
    createdAt: now,
    lastAccessedAt: now,
    expiresAt: new Date(now.getTime() + SESSION_SECONDS * 1000),
  };
  await collections.sessions.insertOne(created);
  isNew = true;
  return rememberSession(request, { session: created, user: null, isNew });
}

export function addSessionCookies(headers: Headers, context: SessionContext) {
  setSessionCookie(headers, context.session._id);
  setCsrfCookie(headers, context.session.csrfToken);
}

export function requireAuthenticated(context: SessionContext | null): asserts context is SessionContext & { user: IdentityUser } {
  requirePasswordAuthenticated(context);
  if (context.user.role === "ADMIN" && !context.session.mfaVerifiedAt) {
    throw new HttpError(403, "Completa la verificación en dos pasos para continuar.");
  }
}

export function requirePasswordAuthenticated(context: SessionContext | null): asserts context is SessionContext & { user: IdentityUser } {
  if (!context?.user) throw new HttpError(401, "Inicia sesión para continuar.");
}

export function requireAdmin(context: SessionContext | null): asserts context is SessionContext & { user: IdentityUser } {
  requireAuthenticated(context);
  if (context.user.role !== "ADMIN") throw new HttpError(403, "No tienes permiso para realizar esta acción.");
}

export function requireCsrf(request: Request, context: SessionContext | null, submittedToken = "") {
  if (!context) throw new HttpError(403, "La solicitud de seguridad ha caducado. Recarga la página.");
  const header = request.headers.get("x-xsrf-token") ?? submittedToken;
  const cookieToken = cookies(request).get("XSRF-TOKEN") ?? "";
  if (!header || !cookieToken || !secureEqual(header, cookieToken) || !secureEqual(header, context.session.csrfToken)) {
    throw new HttpError(403, "La solicitud de seguridad ha caducado. Recarga la página.");
  }
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).origin !== new URL(request.url).origin) throw new HttpError(403, "Origen no permitido.");
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(403, "Origen no permitido.");
    }
  }
}

export async function rotateSession(request: Request, context: SessionContext, user: IdentityUser, options: { mfaVerifiedAt?: Date } = {}) {
  const { collections } = await getStore();
  const prior = context.session;
  const now = new Date();
  const next: IdentitySession = {
    _id: randomToken(32),
    userId: user._id,
    email: user.email,
    csrfToken: randomToken(32),
    createdAt: now,
    lastAccessedAt: now,
    expiresAt: new Date(now.getTime() + SESSION_SECONDS * 1000),
    userAgent: request.headers.get("user-agent")?.slice(0, 512),
    ...(prior.requestedAuthorization ? { requestedAuthorization: prior.requestedAuthorization } : {}),
    ...(options.mfaVerifiedAt ? { mfaVerifiedAt: options.mfaVerifiedAt } : {}),
  };
  await collections.sessions.insertOne(next);
  await collections.sessions.deleteOne({ _id: prior._id });
  return { session: next, user, isNew: true } satisfies SessionContext;
}

export async function saveSession(context: SessionContext) {
  const { collections } = await getStore();
  const { _id, ...values } = context.session;
  await collections.sessions.updateOne({ _id }, { $set: values });
}

export async function revokeUserSessions(email: string) {
  const { collections } = await getStore();
  await collections.sessions.deleteMany({ email: email.toLowerCase() });
}
