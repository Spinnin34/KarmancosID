import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID, createHash, createHmac } from "node:crypto";
import { after, test } from "node:test";
import bcrypt from "bcryptjs";
import { MongoMemoryServer } from "mongodb-memory-server";

const testDatabaseName = `karmancosid_ci_${randomUUID().replaceAll("-", "")}`;
let memoryMongo: MongoMemoryServer | undefined;

if (!process.env.MONGODB_URI) {
  memoryMongo = await MongoMemoryServer.create({ instance: { dbName: testDatabaseName } });
  process.env.MONGODB_URI = memoryMongo.getUri();
}
const databaseAvailable = true;

if (databaseAvailable) {
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privatePem = keys.privateKey.export({ type: "pkcs8", format: "pem" });
  const publicPem = keys.publicKey.export({ type: "spki", format: "pem" });
  process.env.MONGODB_DATABASE = testDatabaseName;
  process.env.KARMANCOS_ISSUER = "https://id.example.test";
  process.env.PUBLIC_IDENTITY_ISSUER = "https://id.example.test";
  process.env.KARMANCOS_SUBJECT_HMAC_SECRET = "ci-only-subject-secret-with-at-least-32-characters";
  process.env.KARMANCOS_PRIVATE_KEY_PEM_B64 = Buffer.from(privatePem).toString("base64");
  process.env.KARMANCOS_PUBLIC_KEY_PEM_B64 = Buffer.from(publicPem).toString("base64");
  process.env.KARMANCOS_MFA_ENCRYPTION_KEY_B64 = Buffer.alloc(32, 11).toString("base64");
  process.env.KARMANCOS_SECURE_COOKIES = "false";
  process.env.KARMANCOS_BOOTSTRAP_ADMIN_EMAIL = "admin@example.test";
  process.env.KARMANCOS_BOOTSTRAP_ADMIN_PASSWORD = "test-only-admin-password-2026";
}

const issuerOrigin = "https://id.example.test";
const { handleIdentityRequest } = await import("../src/server/identity/handler");
const { getStore, closeStore } = await import("../src/server/identity/storage");
const { totpForStep } = await import("../src/server/identity/totp");
const { pairwiseSubject } = await import("../src/server/identity/security");

type CookieJar = Map<string, string>;
type RequestOptions = {
  method?: string;
  body?: Record<string, unknown> | URLSearchParams;
  origin?: string;
};

async function call(jar: CookieJar, path: string, options: RequestOptions = {}) {
  const method = options.method ?? "GET";
  const headers = new Headers();
  if (jar.size) headers.set("cookie", [...jar].map(([name, value]) => `${name}=${value}`).join("; "));
  if (options.origin) headers.set("origin", options.origin);
  else if (!new Set(["GET", "HEAD"]).has(method)) headers.set("origin", issuerOrigin);
  if (options.body instanceof URLSearchParams) {
    headers.set("content-type", "application/x-www-form-urlencoded");
  } else if (options.body) {
    headers.set("content-type", "application/json");
  }
  if (!new Set(["GET", "HEAD", "OPTIONS"]).has(method) && jar.has("XSRF-TOKEN")) {
    headers.set("x-xsrf-token", jar.get("XSRF-TOKEN")!);
  }
  const body = options.body instanceof URLSearchParams ? options.body.toString()
    : options.body ? JSON.stringify(options.body) : undefined;
  const response = await handleIdentityRequest(new Request(new URL(path, issuerOrigin), { method, headers, body }));
  for (const value of response.headers.getSetCookie()) {
    const pair = value.split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator > 0) jar.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
  return response;
}

async function json(response: Response) {
  return await response.json() as Record<string, unknown>;
}

async function initializeCsrf(jar: CookieJar) {
  const response = await call(jar, "/api/auth/csrf");
  assert.equal(response.status, 200);
  assert.ok(jar.get("XSRF-TOKEN"));
}

test("registration, CSRF, admin MFA, recovery, OIDC and PKCE work together", { skip: !databaseAvailable }, async () => {
  const userJar: CookieJar = new Map();
  await initializeCsrf(userJar);
  const legacyPassword = "legacy-account-password-2026";
  await (await getStore()).collections.users.insertOne({
    _id: "legacy-user-1",
    email: "legacy@example.test",
    username: "legacy-user",
    firstName: "Legacy",
    lastName: "Account",
    secondLastName: "",
    displayName: "Legacy Account",
    passwordHash: await bcrypt.hash(legacyPassword, 12),
    role: "USER",
    active: true,
    emailVerified: true,
    createdAt: new Date(),
  });
  const legacyUserJar: CookieJar = new Map();
  await initializeCsrf(legacyUserJar);
  const legacyLogin = await call(legacyUserJar, "/api/auth/login", {
    method: "POST", body: { identifier: "legacy-user", password: legacyPassword },
  });
  assert.equal(legacyLogin.status, 200);
  assert.equal((await json(await call(legacyUserJar, "/api/auth/me"))).emailVerified, true);

  const email = `user-${randomUUID().replaceAll("-", "").slice(0, 12)}@example.test`;
  const registration = await call(userJar, "/api/auth/register", {
    method: "POST",
    body: { username: email.split("@")[0], firstName: "Test", lastName: "User", email, password: "test-user-password-2026" },
  });
  assert.equal(registration.status, 201, await registration.clone().text());
  const user = await (await getStore()).collections.users.findOne({ email });
  assert.ok(user);
  assert.equal(user.emailVerified, false);

  assert.equal((await call(userJar, "/api/auth/verify-email")).status, 404);
  assert.equal((await call(userJar, "/api/auth/password/reset")).status, 404);

  const userLogin = await call(userJar, "/api/auth/login", {
    method: "POST", body: { identifier: email, password: "test-user-password-2026" },
  });
  assert.equal(userLogin.status, 200);
  assert.equal((await json(userLogin)).next, "/cuenta");
  assert.equal((await call(userJar, "/api/auth/me")).status, 200);

  const adminJar: CookieJar = new Map();
  await initializeCsrf(adminJar);
  const adminLogin = await call(adminJar, "/api/auth/login", {
    method: "POST", body: { identifier: "admin@example.test", password: "test-only-admin-password-2026" },
  });
  assert.equal(adminLogin.status, 200);
  assert.equal((await json(adminLogin)).requiresMfaSetup, true);
  assert.equal((await call(adminJar, "/api/admin/overview")).status, 403);

  const setup = await call(adminJar, "/api/auth/mfa/setup");
  assert.equal(setup.status, 200);
  const setupDetails = await json(setup);
  const setupCode = totpForStep(String(setupDetails.secret), Math.floor(Date.now() / 30_000));
  const enableMfa = await call(adminJar, "/api/auth/mfa/setup/verify", { method: "POST", body: { code: setupCode } });
  assert.equal(enableMfa.status, 200);
  const recoveryCodes = (await json(enableMfa)).recoveryCodes as string[];
  assert.equal(recoveryCodes.length, 10);
  assert.equal((await call(adminJar, "/api/admin/overview")).status, 200);

  const admin = await (await getStore()).collections.users.findOne({ email: "admin@example.test" });
  assert.ok(admin);
  const adminSession = await (await getStore()).collections.sessions.findOne({ _id: adminJar.get("KARMANCOSID") });
  assert.equal(adminJar.get("XSRF-TOKEN"), adminSession?.csrfToken);
  const selfRecovery = await call(adminJar, `/api/admin/users/${admin._id}/recovery-code`, { method: "POST" });
  assert.equal(selfRecovery.status, 409, await selfRecovery.clone().text());

  const signout = await call(adminJar, "/api/auth/logout", { method: "POST" });
  assert.equal(signout.status, 204);
  await initializeCsrf(adminJar);
  const secondLogin = await call(adminJar, "/api/auth/login", {
    method: "POST", body: { identifier: "admin@example.test", password: "test-only-admin-password-2026" },
  });
  assert.equal((await json(secondLogin)).requiresMfa, true);
  const verifyRecovery = await call(adminJar, "/api/auth/mfa/verify", { method: "POST", body: { code: recoveryCodes[0] } });
  assert.equal(verifyRecovery.status, 200);
  const reuseRecovery = await call(adminJar, "/api/auth/mfa/verify", { method: "POST", body: { code: recoveryCodes[0] } });
  assert.equal(reuseRecovery.status, 401);
  assert.equal((await call(adminJar, "/api/admin/overview")).status, 200);

  const createClient = await call(adminJar, "/api/admin/clients", {
    method: "POST",
    body: {
      name: "Test client",
      clientType: "public",
      redirectUris: ["https://client.example.test/callback"],
      postLogoutRedirectUris: [],
      allowedOrigins: ["https://client.example.test"],
    },
  });
  assert.equal(createClient.status, 201);
  assert.equal(typeof (await json(createClient)).clientId, "string");

  await (await getStore()).collections.clients.insertOne({
    _id: "legacy-client-record",
    clientId: "kmc_legacy_001",
    clientName: "Legacy client",
    clientAuthenticationMethods: ["none"],
    authorizationGrantTypes: ["authorization_code"],
    redirectUris: ["https://client.example.test/callback"],
    postLogoutRedirectUris: [],
    allowedOrigins: ["https://client.example.test"],
    scopes: ["openid", "profile", "email"],
    requireProofKey: true,
    requireAuthorizationConsent: true,
    accessTokenTimeToLive: "PT5M",
    refreshTokenTimeToLive: "P30D",
    reuseRefreshTokens: false,
    accessTokenFormat: "self-contained",
    clientIdIssuedAt: new Date(),
  });
  const legacyClient = await (await getStore()).collections.clients.findOne({ clientId: "kmc_legacy_001" });
  assert.ok(legacyClient);
  const legacyUser = await (await getStore()).collections.users.findOne({ _id: "legacy-user-1" });
  assert.ok(legacyUser);
  const expectedLegacySubject = createHmac("sha256", process.env.KARMANCOS_SUBJECT_HMAC_SECRET!)
    .update(`https://client.example.test\0legacy-user-1`)
    .digest("base64url");
  assert.equal(await pairwiseSubject(legacyUser, legacyClient), expectedLegacySubject);
  const clientId = legacyClient.clientId;
  const redirectUri = "https://client.example.test/callback";
  const verifier = "v".repeat(64);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomUUID();
  const nonce = randomUUID();
  const authorizeQuery = new URLSearchParams({
    response_type: "code", client_id: clientId, redirect_uri: redirectUri, scope: "openid profile email",
    state, nonce, code_challenge: challenge, code_challenge_method: "S256",
  });
  const authorize = await call(adminJar, `/oauth2/authorize?${authorizeQuery}`);
  assert.equal(authorize.status, 302);
  assert.ok(authorize.headers.get("location")?.startsWith("/consent?"));

  const consent = new URLSearchParams();
  consent.set("_csrf", adminJar.get("XSRF-TOKEN")!);
  consent.set("client_id", clientId);
  consent.set("state", state);
  consent.append("scope", "openid");
  consent.append("scope", "profile");
  consent.append("scope", "email");
  const approved = await call(adminJar, "/oauth2/authorize", { method: "POST", body: consent });
  assert.equal(approved.status, 302);
  const callback = new URL(approved.headers.get("location")!);
  assert.equal(callback.searchParams.get("state"), state);
  const authorizationCode = callback.searchParams.get("code");
  assert.ok(authorizationCode);

  const tokenRequest = (codeVerifier: string) => new URLSearchParams({
    grant_type: "authorization_code", client_id: clientId, code: authorizationCode!, redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });
  const invalidPkce = await call(new Map(), "/oauth2/token", {
    method: "POST", body: tokenRequest("x".repeat(64)), origin: "https://client.example.test",
  });
  assert.equal(invalidPkce.status, 400);
  const tokensResponse = await call(new Map(), "/oauth2/token", {
    method: "POST", body: tokenRequest(verifier), origin: "https://client.example.test",
  });
  assert.equal(tokensResponse.status, 200);
  const tokens = await json(tokensResponse);
  assert.equal(typeof tokens.access_token, "string");
  const idTokenClaims = JSON.parse(Buffer.from(String(tokens.id_token).split(".")[1], "base64url").toString("utf8"));
  assert.equal(idTokenClaims.nonce, nonce);
  assert.equal(idTokenClaims.email_verified, false);

  const replayedCode = await call(new Map(), "/oauth2/token", {
    method: "POST", body: tokenRequest(verifier), origin: "https://client.example.test",
  });
  assert.equal(replayedCode.status, 400);
  const userinfo = await call(new Map(), "/userinfo", { origin: "https://client.example.test" });
  assert.equal(userinfo.status, 401);
  const authorizedUserinfo = await handleIdentityRequest(new Request(`${issuerOrigin}/userinfo`, {
    headers: { authorization: `Bearer ${tokens.access_token}`, origin: "https://client.example.test" },
  }));
  assert.equal(authorizedUserinfo.status, 200);
  assert.equal((await json(authorizedUserinfo)).email_verified, false);

  const issuedRecovery = await call(adminJar, `/api/admin/users/${user._id}/recovery-code`, { method: "POST" });
  assert.equal(issuedRecovery.status, 201);
  const recoveryCode = (await json(issuedRecovery)).recoveryCode as string;
  const recoveryJar: CookieJar = new Map();
  await initializeCsrf(recoveryJar);
  const completeRecovery = await call(recoveryJar, "/api/auth/recovery/complete", {
    method: "POST", body: { recoveryCode, newPassword: "new-test-user-password-2026" },
  });
  assert.equal(completeRecovery.status, 200);
  assert.equal((await call(userJar, "/api/auth/me")).status, 401);
  await initializeCsrf(recoveryJar);
  const reusedAccountRecovery = await call(recoveryJar, "/api/auth/recovery/complete", {
    method: "POST", body: { recoveryCode, newPassword: "another-test-password-2026" },
  });
  assert.equal(reusedAccountRecovery.status, 400);
  await initializeCsrf(userJar);
  const recoveredLogin = await call(userJar, "/api/auth/login", {
    method: "POST", body: { identifier: email, password: "new-test-user-password-2026" },
  });
  assert.equal(recoveredLogin.status, 200);
});

after(async () => {
  if (!databaseAvailable) return;
  try {
    const store = await getStore();
    await store.db.dropDatabase();
  } finally {
    await closeStore();
    await memoryMongo?.stop();
  }
});
