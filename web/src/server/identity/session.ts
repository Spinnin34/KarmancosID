import type { Filter } from "mongodb";
import { randomToken, secureEqual } from "./security";
import { HttpError, type IdentitySession, type IdentityUser } from "./types";
import { getStore } from "./storage";
import { appendCookie } from "./http";
import { isAuthorizationRequestCurrent } from "./auth-flow";

const PERSISTENT_SESSION_SECONDS = 100 * 365 * 24 * 60 * 60;
const TEMPORARY_SESSION_SECONDS = 30 * 60;
const SESSION_TOUCH_INTERVAL_MS = 5 * 60_000;
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
  parts.push(`Max-Age=${options.clear ? 0 : options.maxAge ?? PERSISTENT_SESSION_SECONDS}`);
  return parts.join("; ");
}

function sessionExpirySeconds(user: IdentityUser | null, mfaVerifiedAt?: Date): number | null {
  if (!user || (user.role === "ADMIN" && !mfaVerifiedAt)) return TEMPORARY_SESSION_SECONDS;
  return null;
}

function sessionCookieLifetimeSeconds(user: IdentityUser | null, mfaVerifiedAt?: Date) {
  return sessionExpirySeconds(user, mfaVerifiedAt) ?? PERSISTENT_SESSION_SECONDS;
}

export function activeSessionFilter(now = new Date()): Filter<IdentitySession> {
  return {
    $or: [
      { expiresAt: { $gt: now } },
      { expiresAt: { $exists: false }, userId: { $ne: null } },
    ],
  };
}

export function setSessionCookie(headers: Headers, sid: string, maxAge = PERSISTENT_SESSION_SECONDS) {
  appendCookie(headers, cookie(SESSION_COOKIE, sid, { httpOnly: true, maxAge }));
}

export function setCsrfCookie(headers: Headers, token: string, maxAge = PERSISTENT_SESSION_SECONDS) {
  appendCookie(headers, cookie("XSRF-TOKEN", token, { maxAge }));
}

export function clearAuthCookies(headers: Headers) {
  appendCookie(headers, cookie(SESSION_COOKIE, "", { httpOnly: true, clear: true }));
  appendCookie(headers, cookie("XSRF-TOKEN", "", { clear: true }));
}

export async function loadSession(request: Request, create = false): Promise<SessionContext | null> {
  const sid = cookies(request).get(SESSION_COOKIE);
  const { collections } = await getStore();
  let session = sid
    ? await collections.sessions.findOne({ _id: sid, ...activeSessionFilter() })
    : null;
  let isNew = false;

  if (session && session.userId) {
    const now = new Date();
    const user = await collections.users.findOne({ _id: session.userId, active: true });
    if (!user) {
      await collections.sessions.deleteOne({ _id: session._id });
      session = null;
    } else {
      await touchSession(session, now, sessionExpirySeconds(user, session.mfaVerifiedAt), collections.sessions);
      return rememberSession(request, { session, user, isNew });
    }
  }

  if (session) {
    const now = new Date();
    await touchSession(session, now, TEMPORARY_SESSION_SECONDS, collections.sessions);
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
    expiresAt: new Date(now.getTime() + TEMPORARY_SESSION_SECONDS * 1000),
  };
  await collections.sessions.insertOne(created);
  isNew = true;
  return rememberSession(request, { session: created, user: null, isNew });
}

async function touchSession(
  session: IdentitySession,
  now: Date,
  lifetimeSeconds: number | null,
  sessions: Awaited<ReturnType<typeof getStore>>["collections"]["sessions"],
) {
  const previousAccess = session.lastAccessedAt instanceof Date ? session.lastAccessedAt.getTime() : 0;
  const previousExpiry = session.expiresAt instanceof Date ? session.expiresAt.getTime() : 0;
  if (lifetimeSeconds === null) {
    if (now.getTime() - previousAccess < SESSION_TOUCH_INTERVAL_MS && !session.expiresAt) return;
    await sessions.updateOne({ _id: session._id }, { $set: { lastAccessedAt: now }, $unset: { expiresAt: "" } });
    session.lastAccessedAt = now;
    delete session.expiresAt;
    return;
  }
  if (now.getTime() - previousAccess < SESSION_TOUCH_INTERVAL_MS
    && previousExpiry > now.getTime() + SESSION_TOUCH_INTERVAL_MS) return;

  const expiresAt = new Date(now.getTime() + lifetimeSeconds * 1000);
  await sessions.updateOne({ _id: session._id }, { $set: { lastAccessedAt: now, expiresAt } });
  session.lastAccessedAt = now;
  session.expiresAt = expiresAt;
}

export function addSessionCookies(headers: Headers, context: SessionContext) {
  const maxAge = sessionCookieLifetimeSeconds(context.user, context.session.mfaVerifiedAt);
  setSessionCookie(headers, context.session._id, maxAge);
  setCsrfCookie(headers, context.session.csrfToken, maxAge);
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
  const expirySeconds = sessionExpirySeconds(user, options.mfaVerifiedAt);
  const next: IdentitySession = {
    _id: randomToken(32),
    userId: user._id,
    email: user.email,
    csrfToken: randomToken(32),
    createdAt: now,
    lastAccessedAt: now,
    ...(expirySeconds === null ? {} : { expiresAt: new Date(now.getTime() + expirySeconds * 1000) }),
    userAgent: request.headers.get("user-agent")?.slice(0, 512),
    ...(isAuthorizationRequestCurrent(prior.requestedAuthorization) ? { requestedAuthorization: prior.requestedAuthorization } : {}),
    ...(options.mfaVerifiedAt ? { mfaVerifiedAt: options.mfaVerifiedAt } : {}),
  };
  await collections.sessions.insertOne(next);
  const nextContext = { session: next, user, isNew: true } satisfies SessionContext;
  rememberSession(request, nextContext);
  await collections.sessions.deleteOne({ _id: prior._id });
  return nextContext;
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
