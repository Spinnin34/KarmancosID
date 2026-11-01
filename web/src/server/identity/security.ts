import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { importPKCS8, importSPKI, SignJWT, jwtVerify, calculateJwkThumbprint } from "jose";
import { HttpError, type IdentityUser, type OAuthClient } from "./types";

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export const normalizeEmail = (value: string) => value.trim().toLowerCase();
export const normalizeIdentifier = (value: string) => value.trim().toLowerCase();
export const sessionReference = (sid: string) => sha256(`karmancos-session-reference\0${sid}`);

export function emailRegex(value: string): boolean {
  return value.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function validateIdentity(input: Record<string, unknown>, includePassword = true): string | null {
  const username = String(input.username ?? "").trim();
  const firstName = String(input.firstName ?? "").trim();
  const lastName = String(input.lastName ?? "").trim();
  const secondLastName = String(input.secondLastName ?? "").trim();
  const email = String(input.email ?? "").trim();
  const password = String(input.password ?? "");
  if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) return "El usuario debe tener entre 3 y 32 caracteres válidos.";
  if (!firstName || firstName.length > 80) return "Escribe un nombre de hasta 80 caracteres.";
  if (!lastName || lastName.length > 80) return "Escribe un primer apellido de hasta 80 caracteres.";
  if (secondLastName.length > 80) return "El segundo apellido debe tener 80 caracteres o menos.";
  if (!emailRegex(email)) return "Escribe un correo electrónico válido.";
  if (includePassword && (password.length < 12 || password.length > 128)) return "La contraseña debe tener entre 12 y 128 caracteres.";
  return null;
}

export function validateRedirectUris(values: unknown): string[] {
  if (!Array.isArray(values) || values.length < 1 || values.length > 10) {
    throw new HttpError(400, "Añade al menos una URL exacta.");
  }
  return normalizeUnique(values.map((item) => {
    const text = String(item ?? "").trim();
    let url: URL;
    try { url = new URL(text); } catch { throw new HttpError(400, "Cada URL de retorno debe ser HTTPS; HTTP solo se permite en localhost durante desarrollo."); }
    const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (!url.hostname || url.username || url.password || url.hash || text.includes("*") || text.includes(",") || (url.protocol !== "https:" && !localHttp)) {
      throw new HttpError(400, "Cada URL de retorno debe ser HTTPS; HTTP solo se permite en localhost durante desarrollo.");
    }
    return url.href;
  }));
}

export function validateOrigins(values: unknown): string[] {
  if (values == null) return [];
  if (!Array.isArray(values) || values.length > 10) throw new HttpError(400, "Revisa los orígenes autorizados.");
  return normalizeUnique(values.map((item) => {
    let url: URL;
    try { url = new URL(String(item ?? "").trim()); } catch { throw new HttpError(400, "Cada origen autorizado debe ser HTTPS y no contener ruta, consulta ni fragmento."); }
    const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (!url.hostname || url.username || url.password || url.search || url.hash || url.pathname !== "/" || (url.protocol !== "https:" && !localHttp)) {
      throw new HttpError(400, "Cada origen autorizado debe ser HTTPS y no contener ruta, consulta ni fragmento.");
    }
    return url.origin;
  }));
}

function normalizeUnique(values: string[]): string[] {
  return [...new Set(values)];
}

export function safeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/cuenta";
  try {
    const url = new URL(value, "https://karmancos.invalid");
    return url.origin === "https://karmancos.invalid" ? url.pathname + url.search + url.hash : "/cuenta";
  } catch { return "/cuenta"; }
}

export function secureEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

let privateKeyPromise: ReturnType<typeof importPKCS8> | undefined;
let publicKeyPromise: ReturnType<typeof importSPKI> | undefined;
let publicJwkPromise: Promise<{ kty: string; n: string; e: string; use: string; alg: string; kid: string }> | undefined;

function getPrivateKey() {
  if (!privateKeyPromise) {
    const pem = decodePem(process.env.KARMANCOS_PRIVATE_KEY_PEM_B64, "KARMANCOS_PRIVATE_KEY_PEM_B64");
    privateKeyPromise = importPKCS8(pem, "RS256");
  }
  return privateKeyPromise;
}

function getPublicKey() {
  if (!publicKeyPromise) {
    const pem = decodePem(process.env.KARMANCOS_PUBLIC_KEY_PEM_B64, "KARMANCOS_PUBLIC_KEY_PEM_B64");
    publicKeyPromise = importSPKI(pem, "RS256");
  }
  return publicKeyPromise;
}

function decodePem(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Required signing key is missing: ${name}`);
  const decoded = Buffer.from(value.trim(), "base64").toString("utf8");
  if (!decoded.includes("-----BEGIN") || !decoded.includes("-----END")) throw new Error(`Invalid signing key format: ${name}`);
  return decoded;
}

export async function signingJwks() {
  if (!publicJwkPromise) {
    publicJwkPromise = (async () => {
      const key = await getPublicKey();
      const jwk = await (await import("jose")).exportJWK(key) as { kty: string; n: string; e: string };
      const kid = await calculateJwkThumbprint(jwk, "sha256");
      return { kty: jwk.kty, n: jwk.n, e: jwk.e, use: "sig", alg: "RS256", kid };
    })();
  }
  return publicJwkPromise;
}

export async function signAccessToken(user: IdentityUser, client: OAuthClient, scopes: string[], now = new Date()) {
  const issuer = getIssuer();
  const subject = await pairwiseSubject(user, client);
  const jwk = await signingJwks();
  const key = await getPrivateKey();
  const expiresIn = 300;
  return new SignJWT({ scope: scopes.join(" "), client_id: client.clientId, email: scopes.includes("email") ? user.email : undefined })
    .setProtectedHeader({ alg: "RS256", kid: jwk.kid, typ: "at+jwt" })
    .setIssuer(issuer)
    .setSubject(subject)
    .setAudience(client.clientId)
    .setIssuedAt(Math.floor(now.getTime() / 1000))
    .setExpirationTime(Math.floor(now.getTime() / 1000) + expiresIn)
    .setJti(randomToken(16))
    .sign(key);
}

export async function signIdToken(user: IdentityUser, client: OAuthClient, scopes: string[], nonce?: string, now = new Date()) {
  const jwk = await signingJwks();
  const key = await getPrivateKey();
  const timestamp = Math.floor(now.getTime() / 1000);
  const claims: Record<string, unknown> = { auth_time: timestamp };
  if (nonce) claims.nonce = nonce;
  if (scopes.includes("profile")) {
    claims.name = user.displayName;
    claims.preferred_username = user.username;
    claims.given_name = user.firstName;
    claims.family_name = [user.lastName, user.secondLastName].filter(Boolean).join(" ");
    if (user.profilePicture && user.profilePictureContentType && user.profilePictureUpdatedAt) {
      const pictureUrl = new URL(
        `/api/public/users/${encodeURIComponent(user._id)}/picture?v=${new Date(user.profilePictureUpdatedAt).getTime()}`,
        getIssuer(),
      );
      claims.picture = pictureUrl.toString();
    }
  }
  if (scopes.includes("email")) {
    claims.email = user.email;
    claims.email_verified = Boolean(user.emailVerified);
  }
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: jwk.kid, typ: "JWT" })
    .setIssuer(getIssuer())
    .setSubject(await pairwiseSubject(user, client))
    .setAudience(client.clientId)
    .setIssuedAt(timestamp)
    .setExpirationTime(timestamp + 300)
    .sign(key);
}

export async function verifyAccessToken(token: string) {
  return jwtVerify(token, await getPublicKey(), { issuer: getIssuer(), algorithms: ["RS256"] });
}

export function getIssuer(): string {
  const issuer = process.env.KARMANCOS_ISSUER ?? process.env.PUBLIC_IDENTITY_ISSUER;
  if (!issuer) throw new Error("Identity issuer is not configured.");
  const url = new URL(issuer);
  if (url.protocol !== "https:" && url.hostname !== "localhost") throw new Error("Identity issuer must use HTTPS.");
  return url.origin;
}

export async function pairwiseSubject(user: IdentityUser, client: OAuthClient) {
  const secret = process.env.KARMANCOS_SUBJECT_HMAC_SECRET;
  if (!secret || secret.length < 32) throw new Error("Identity subject signing secret is missing or too short.");
  const redirectHosts = client.redirectUris.map((uri) => {
    try { return new URL(uri).hostname; } catch { return null; }
  }).filter((host): host is string => Boolean(host)).sort();
  const sector = client.allowedOrigins?.slice().sort()[0] || redirectHosts[0] || client.clientId;
  return createHmac("sha256", secret).update(`${sector}\0${user._id}`).digest("base64url");
}
