import { createHash } from "node:crypto";
import { randomToken, sha256, getIssuer, signAccessToken, signIdToken, signingJwks, verifyAccessToken, normalizeEmail, secureEqual } from "./security";
import { getStore } from "./storage";
import { addSessionCookies, clearAuthCookies, loadSession, requireAuthenticated, requireCsrf, saveSession } from "./session";
import { compareClientSecret, consentId, getClientByClientId } from "./client-repository";
import { logAudit } from "./operations";
import { pictureUrl } from "./user-repository";
import { empty, json, readForm } from "./http";
import { HttpError, type AuthorizationRequest, type IdentityUser, type OAuthClient } from "./types";

const AUTH_CODE_SECONDS = 5 * 60;
const ACCESS_TOKEN_SECONDS = 5 * 60;

export async function oauthEndpoint(request: Request, path: string): Promise<Response | null> {
  const method = request.method.toUpperCase();

  if (path === "/oauth2/authorize" && method === "GET") return authorize(request);
  if (path === "/oauth2/authorize" && method === "POST") return acceptConsent(request);
  if (path === "/oauth2/jwks" && method === "GET") {
    const jwk = await signingJwks();
    return json({ keys: [jwk] }, 200, {
      "Cache-Control": "public, max-age=300, s-maxage=300",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET",
    });
  }
  if (["/oauth2/token", "/oauth2/revoke", "/oauth2/introspect"].includes(path) && method === "OPTIONS") return tokenPreflight(request);
  if (path === "/oauth2/token" && method === "POST") return token(request);
  if (path === "/oauth2/revoke" && method === "POST") return revoke(request);
  if (path === "/oauth2/introspect" && method === "POST") return introspect(request);
  if (path === "/userinfo" && (method === "GET" || method === "POST")) return userinfo(request);
  if (path === "/connect/logout" && method === "GET") return logout(request);
  return null;
}

async function authorize(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const params = url.searchParams;
  const clientId = params.get("client_id") || "";
  const redirectUri = params.get("redirect_uri") || "";
  const responseType = params.get("response_type") || "";
  const state = params.get("state") || "";
  const scopes = [...new Set((params.get("scope") || "").split(/\s+/).filter(Boolean))];
  const nonce = params.get("nonce") || undefined;
  const codeChallenge = params.get("code_challenge") || "";
  const challengeMethod = params.get("code_challenge_method") || "";

  const client = await getClientByClientId(clientId);
  if (!client) return localError("invalid_request", "No se reconoce el servicio que solicita acceso.");
  if (!client.redirectUris.includes(redirectUri)) return localError("invalid_request", "La URL de retorno no está registrada para este servicio.");
  if (responseType !== "code") return oauthRedirectError(redirectUri, "unsupported_response_type", state);
  if (!state || !scopes.includes("openid") || scopes.some((scope) => !client.scopes.includes(scope))) {
    return oauthRedirectError(redirectUri, "invalid_scope", state);
  }
  if (challengeMethod !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)) {
    return oauthRedirectError(redirectUri, "invalid_request", state);
  }

  const pending: AuthorizationRequest = {
    clientId, redirectUri, responseType: "code", scopes, state, codeChallenge,
    codeChallengeMethod: "S256", createdAt: Date.now(), ...(nonce ? { nonce } : {}),
  };
  const session = await loadSession(request, true);
  if (!session) throw new Error("Could not create identity session.");
  session.session.requestedAuthorization = pending;

  const prompt = (params.get("prompt") || "").split(/\s+/).filter(Boolean);
  if (!session.user || (session.user.role === "ADMIN" && !session.session.mfaVerifiedAt)) {
    if (prompt.includes("none")) return oauthRedirectError(redirectUri, "login_required", state);
    await saveSession(session);
    const headers = new Headers();
    addSessionCookies(headers, session);
    return new Response(null, { status: 302, headers: addLocation(headers, "/login") });
  }

  if (prompt.includes("login")) {
    const headers = new Headers();
    addSessionCookies(headers, session);
    await saveSession(session);
    return new Response(null, { status: 302, headers: addLocation(headers, "/login") });
  }

  const consent = await existingConsent(client._id, session.user.email);
  const hasConsent = consent && scopes.every((scope) => consent.includes(scope));
  if ((client.requireAuthorizationConsent && !hasConsent) || prompt.includes("consent")) {
    if (prompt.includes("none")) return oauthRedirectError(redirectUri, "consent_required", state);
    await saveSession(session);
    const query = new URLSearchParams({ client_id: clientId, state, scope: scopes.join(" ") });
    const headers = new Headers();
    addSessionCookies(headers, session);
    return new Response(null, { status: 302, headers: addLocation(headers, `/consent?${query.toString()}`) });
  }

  return issueCode(session, client, pending, scopes);
}

async function acceptConsent(request: Request): Promise<Response> {
  const session = await loadSession(request);
  if (!session?.user) return localError("login_required", "Inicia sesión para autorizar el servicio.", 401);
  requireAuthenticated(session);
  const form = await readForm(request);
  requireCsrf(request, session, form.get("_csrf") || "");
  const pending = session.session.requestedAuthorization;
  if (!pending || pending.createdAt < Date.now() - 10 * 60_000) throw new HttpError(400, "La solicitud de acceso ha caducado. Vuelve al servicio e inténtalo otra vez.");
  if (form.get("client_id") !== pending.clientId || form.get("state") !== pending.state) throw new HttpError(400, "La solicitud de acceso no coincide.");
  const selectedScopes = [...new Set(form.getAll("scope").flatMap((value) => value.split(/\s+/)).filter(Boolean))];
  if (!selectedScopes.includes("openid") || selectedScopes.some((scope) => !pending.scopes.includes(scope))) throw new HttpError(400, "Los permisos seleccionados no coinciden con la solicitud.");
  const client = await getClientByClientId(pending.clientId);
  if (!client) throw new HttpError(400, "No se reconoce el servicio que solicita acceso.");
  const { collections } = await getStore();
  await collections.consents.updateOne(
    { _id: consentId(client._id, session.user.email) },
    { $set: {
      registeredClientId: client._id,
      principalName: normalizeEmail(session.user.email),
      authorities: selectedScopes.map((scope) => `SCOPE_${scope}`),
    } },
    { upsert: true },
  );
  await logAudit(session.user.email, "consent.granted", client.clientName);
  return issueCode(session, client, pending, selectedScopes);
}

async function issueCode(session: NonNullable<Awaited<ReturnType<typeof loadSession>>>, client: OAuthClient, pending: AuthorizationRequest, scopes: string[]) {
  if (!session.user) throw new HttpError(401, "Inicia sesión para continuar.");
  const code = randomToken(32);
  const now = new Date();
  const { collections } = await getStore();
  await collections.authorizations.insertOne({
    _id: sha256(code), kind: "authorization_code", clientId: client.clientId, registeredClientId: client._id,
    principalName: normalizeEmail(session.user.email), userId: session.user._id, redirectUri: pending.redirectUri,
    scopes, codeChallenge: pending.codeChallenge, nonce: pending.nonce, createdAt: now,
    expiresAt: new Date(now.getTime() + AUTH_CODE_SECONDS * 1000),
  });
  delete session.session.requestedAuthorization;
  await saveSession(session);
  await logAudit(session.user.email, "oauth.authorization_code_issued", client.clientName);
  const target = new URL(pending.redirectUri);
  target.searchParams.set("code", code);
  target.searchParams.set("state", pending.state);
  const headers = new Headers();
  addSessionCookies(headers, session);
  return new Response(null, { status: 302, headers: addLocation(headers, target.toString()) });
}

async function existingConsent(registeredClientId: string, email: string): Promise<string[] | null> {
  const { collections } = await getStore();
  const doc = await collections.consents.findOne({ _id: consentId(registeredClientId, email) });
  if (!doc) return null;
  return (doc.authorities ?? []).map((authority: string) => authority.replace(/^SCOPE_/, ""));
}

async function token(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  const form = await readForm(request);
  const auth = await authenticateClient(request, form);
  const cors = await corsForClient(origin, auth.client);
  const grantType = form.get("grant_type") || "";
  if (grantType === "authorization_code") return exchangeCode(form, auth.client, cors);
  if (grantType === "refresh_token") return refreshAccessToken(form, auth.client, cors);
  return oauthJson({ error: "unsupported_grant_type", error_description: "El grant solicitado no está habilitado." }, 400, cors);
}

async function authenticateClient(request: Request, form: URLSearchParams) {
  let clientId = form.get("client_id") || "";
  let secret: string | null = form.get("client_secret");
  let authMethod = secret ? "client_secret_post" : "none";
  const header = request.headers.get("authorization");
  if (header?.toLowerCase().startsWith("basic ")) {
    try {
      const decoded = Buffer.from(header.slice(6).trim(), "base64").toString("utf8");
      const separator = decoded.indexOf(":");
      if (separator < 0) throw new Error("invalid basic credentials");
      const basicClientId = decodeURIComponent(decoded.slice(0, separator));
      if (form.has("client_secret") || (form.has("client_id") && form.get("client_id") !== basicClientId)) throw new Error("conflicting client credentials");
      clientId = basicClientId;
      secret = decodeURIComponent(decoded.slice(separator + 1));
      authMethod = "client_secret_basic";
    } catch { throw new HttpError(401, "invalid_client"); }
  }
  const client = await getClientByClientId(clientId);
  if (!client) throw new HttpError(401, "invalid_client");
  if (!(client.clientAuthenticationMethods ?? []).includes(authMethod)) throw new HttpError(401, "invalid_client");
  if (authMethod === "none") {
    if (secret) throw new HttpError(401, "invalid_client");
  } else if (!secret || !await compareClientSecret(client, secret)) {
    throw new HttpError(401, "invalid_client");
  }
  return { client, clientId };
}

async function exchangeCode(form: URLSearchParams, client: OAuthClient, cors: HeadersInit) {
  const code = form.get("code") || "";
  const redirectUri = form.get("redirect_uri") || "";
  const verifier = form.get("code_verifier") || "";
  if (!code || !redirectUri || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return oauthJson({ error: "invalid_grant" }, 400, cors);
  const { collections } = await getStore();
  const hash = sha256(code);
  const saved = await collections.authorizations.findOne({
    _id: hash, kind: "authorization_code", clientId: client.clientId, redirectUri,
    expiresAt: { $gt: new Date() },
  });
  const verifierChallenge = createHash("sha256").update(verifier).digest("base64url");
  if (!saved || !secureEqual(String(saved.codeChallenge || ""), verifierChallenge)) return oauthJson({ error: "invalid_grant" }, 400, cors);
  const removed = await collections.authorizations.deleteOne({ _id: hash, kind: "authorization_code", expiresAt: { $gt: new Date() } });
  if (removed.deletedCount !== 1) return oauthJson({ error: "invalid_grant" }, 400, cors);
  const user = await collections.users.findOne({ _id: saved.userId, active: true });
  if (!user) return oauthJson({ error: "invalid_grant" }, 400, cors);
  const scopes = Array.isArray(saved.scopes) ? saved.scopes as string[] : [];
  return createTokenResponse(user, client, scopes, typeof saved.nonce === "string" ? saved.nonce : undefined, cors);
}

async function refreshAccessToken(form: URLSearchParams, client: OAuthClient, cors: HeadersInit) {
  if (!(client.authorizationGrantTypes ?? []).includes("refresh_token")) return oauthJson({ error: "unauthorized_client" }, 400, cors);
  const raw = form.get("refresh_token") || "";
  if (!raw) return oauthJson({ error: "invalid_grant" }, 400, cors);
  const { collections } = await getStore();
  const refresh = await collections.authorizations.findOneAndDelete({
    _id: sha256(raw), kind: "refresh_token", clientId: client.clientId, expiresAt: { $gt: new Date() },
  });
  if (!refresh) return oauthJson({ error: "invalid_grant" }, 400, cors);
  const user = await collections.users.findOne({ _id: refresh.userId, active: true });
  if (!user) return oauthJson({ error: "invalid_grant" }, 400, cors);
  const scopes = Array.isArray(refresh.scopes) ? refresh.scopes as string[] : [];
  return createTokenResponse(user, client, scopes, undefined, cors);
}

async function createTokenResponse(user: IdentityUser, client: OAuthClient, scopes: string[], nonce: string | undefined, cors: HeadersInit) {
  const accessToken = await signAccessToken(user, client, scopes);
  const now = new Date();
  const accessClaims = await verifyAccessToken(accessToken);
  const { collections } = await getStore();
  await collections.authorizations.insertOne({
    _id: sha256(accessToken), kind: "access_token", clientId: client.clientId, registeredClientId: client._id,
    principalName: normalizeEmail(user.email), userId: user._id, scopes, expiresAt: new Date(Number(accessClaims.payload.exp) * 1000), createdAt: now,
  });
  const payload: Record<string, unknown> = {
    access_token: accessToken, token_type: "Bearer", expires_in: ACCESS_TOKEN_SECONDS, scope: scopes.join(" "),
  };
  if (scopes.includes("openid")) payload.id_token = await signIdToken(user, client, scopes, nonce, now);
  if ((client.authorizationGrantTypes ?? []).includes("refresh_token")) {
    const refreshToken = randomToken(48);
    const ttl = durationMilliseconds(client.refreshTokenTimeToLive || "P30D");
    await collections.authorizations.insertOne({
      _id: sha256(refreshToken), kind: "refresh_token", clientId: client.clientId, registeredClientId: client._id,
      principalName: normalizeEmail(user.email), userId: user._id, scopes, expiresAt: new Date(now.getTime() + ttl), createdAt: now,
    });
    payload.refresh_token = refreshToken;
  }
  return oauthJson(payload, 200, cors);
}

async function userinfo(request: Request) {
  const token = bearerToken(request);
  if (!token) return oauthJson({ error: "invalid_token" }, 401, { "WWW-Authenticate": 'Bearer error="invalid_token"' });
  try {
    const { payload } = await verifyAccessToken(token);
    const { collections } = await getStore();
    const record = await collections.authorizations.findOne({ _id: sha256(token), kind: "access_token", expiresAt: { $gt: new Date() } });
    if (!record) throw new Error("inactive token");
    const user = await collections.users.findOne({ _id: record.userId, active: true });
    if (!user) throw new Error("missing user");
    const client = await collections.clients.findOne({ clientId: String(record.clientId) });
    if (!client) throw new Error("missing client");
    const scopes = Array.isArray(record.scopes) ? record.scopes as string[] : [];
    const claims: Record<string, unknown> = { sub: payload.sub };
    if (scopes.includes("profile")) {
      claims.name = user.displayName;
      claims.preferred_username = user.username;
      claims.given_name = user.firstName;
      claims.family_name = [user.lastName, user.secondLastName].filter(Boolean).join(" ");
      if (pictureUrl(user)) claims.picture = `${getIssuer()}${pictureUrl(user)}`;
    }
    if (scopes.includes("email")) {
      claims.email = user.email;
      claims.email_verified = Boolean(user.emailVerified);
    }
    return json(claims, 200, await corsForClient(request.headers.get("origin"), client));
  } catch {
    return oauthJson({ error: "invalid_token" }, 401, { "WWW-Authenticate": 'Bearer error="invalid_token"' });
  }
}

async function revoke(request: Request) {
  const form = await readForm(request);
  const { client } = await authenticateClient(request, form);
  const cors = await corsForClient(request.headers.get("origin"), client);
  const token = form.get("token") || "";
  if (token) {
    const { collections } = await getStore();
    const hash = sha256(token);
    const record = await collections.authorizations.findOne({ _id: hash, clientId: client.clientId });
    if (record?.kind === "refresh_token") await collections.authorizations.deleteOne({ _id: hash });
    if (record?.kind === "access_token") {
      await collections.authorizations.deleteOne({ _id: hash });
      await collections.revocations.updateOne({ _id: hash }, { $set: { expiresAt: record.expiresAt, clientId: client.clientId } }, { upsert: true });
    }
  }
  return empty(200, cors);
}

async function introspect(request: Request) {
  const form = await readForm(request);
  const { client } = await authenticateClient(request, form);
  const cors = await corsForClient(request.headers.get("origin"), client);
  const token = form.get("token") || "";
  if (!token) return oauthJson({ active: false }, 200, cors);
  const { collections } = await getStore();
  const record = await collections.authorizations.findOne({ _id: sha256(token), clientId: client.clientId, expiresAt: { $gt: new Date() } });
  if (!record) return oauthJson({ active: false }, 200, cors);
  if (record.kind === "refresh_token") return oauthJson({ active: true, client_id: client.clientId, scope: (record.scopes ?? []).join(" ") }, 200, cors);
  try {
    const { payload } = await verifyAccessToken(token);
    const user = await collections.users.findOne({ _id: record.userId, active: true });
    if (!user) return oauthJson({ active: false }, 200, cors);
    return oauthJson({ active: true, client_id: client.clientId, username: user.email, sub: payload.sub, scope: (record.scopes ?? []).join(" "), exp: payload.exp, iat: payload.iat }, 200, cors);
  } catch { return oauthJson({ active: false }, 200, cors); }
}

async function logout(request: Request) {
  const url = new URL(request.url);
  const redirectUri = url.searchParams.get("post_logout_redirect_uri");
  const clientId = url.searchParams.get("client_id");
  let target = "/";
  if (redirectUri) {
    if (!clientId) throw new HttpError(400, "La solicitud de cierre de sesión no identifica el cliente.");
    const client = await getClientByClientId(clientId);
    if (!client || !(client.postLogoutRedirectUris ?? []).includes(redirectUri)) throw new HttpError(400, "La URL de cierre de sesión no está registrada.");
    const destination = new URL(redirectUri);
    const state = url.searchParams.get("state");
    if (state) destination.searchParams.set("state", state);
    target = destination.toString();
  }
  const session = await loadSession(request);
  if (session?.user) await logAudit(session.user.email, "account.signed_out", session.user.email);
  if (session) {
    const { collections } = await getStore();
    await collections.sessions.deleteOne({ _id: session.session._id });
  }
  const headers = new Headers();
  clearAuthCookies(headers);
  headers.set("Location", target);
  return new Response(null, { status: 302, headers });
}

async function tokenPreflight(request: Request) {
  const origin = request.headers.get("origin");
  const commonHeaders = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "600",
  };
  if (!origin) return empty(204, commonHeaders);
  const { collections } = await getStore();
  const client = await collections.clients.findOne({ allowedOrigins: origin });
  if (!client) return empty(403);
  return empty(204, { ...commonHeaders, "Access-Control-Allow-Origin": origin, "Vary": "Origin" });
}

async function corsForClient(origin: string | null, client: OAuthClient): Promise<Headers> {
  const headers = new Headers();
  if (origin && (client.allowedOrigins ?? []).includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  return headers;
}

function bearerToken(request: Request): string | null {
  const value = request.headers.get("authorization") ?? "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() || null : null;
}

function oauthJson(body: unknown, status = 200, headers: HeadersInit = {}) {
  const result = new Headers(headers);
  result.set("Content-Type", "application/json;charset=UTF-8");
  result.set("Cache-Control", "no-store");
  result.set("Pragma", "no-cache");
  result.set("X-Content-Type-Options", "nosniff");
  return new Response(JSON.stringify(body), { status, headers: result });
}

function oauthRedirectError(uri: string, error: string, state: string) {
  const target = new URL(uri);
  target.searchParams.set("error", error);
  if (state) target.searchParams.set("state", state);
  return new Response(null, { status: 302, headers: { Location: target.toString(), "Cache-Control": "no-store" } });
}

function localError(_error: string, description: string, status = 400) {
  return new Response(`<!doctype html><html lang="es"><meta charset="utf-8"><title>Error de acceso</title><main><h1>No se pudo continuar</h1><p>${escapeHtml(description)}</p><a href="/">Volver a Karmancos ID</a></main></html>`, {
    status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

function addLocation(headers: Headers, location: string) {
  headers.set("Location", location);
  headers.set("Cache-Control", "no-store");
  return headers;
}

function durationMilliseconds(value: string) {
  const match = value.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!match) return 30 * 24 * 60 * 60_000;
  return (((Number(match[1] || 0) * 24 + Number(match[2] || 0)) * 60 + Number(match[3] || 0)) * 60 + Number(match[4] || 0)) * 1000;
}
