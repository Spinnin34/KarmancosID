import { getStore } from "./storage";
import { consumeRateLimit, logAudit } from "./operations";
import { authorizationPath, isAuthorizationRequestCurrent } from "./auth-flow";
import { addSessionCookies, loadSession, requireCsrf, requirePasswordAuthenticated, rotateSession, saveSession } from "./session";
import { json, readJson, requireString } from "./http";
import { createRecoveryCodes, decryptTotpSecret, encryptTotpSecret, normalizeRecoveryCode, createTotpSecret, totpStepForCode, totpUri } from "./totp";
import { HttpError } from "./types";
import { sha256 } from "./security";

const SETUP_LIFETIME_MS = 10 * 60_000;

export async function mfaEndpoint(request: Request, path: string): Promise<Response | null> {
  if (path === "/api/auth/mfa/setup" && request.method === "GET") return beginSetup(request);
  if (path === "/api/auth/mfa/setup/verify" && request.method === "POST") return verifySetup(request);
  if (path === "/api/auth/mfa/verify" && request.method === "POST") return verifyLogin(request);
  return null;
}

async function beginSetup(request: Request): Promise<Response> {
  const context = await loadSession(request);
  requirePasswordAuthenticated(context);
  requireAdminRole(context.user.role);
  if (context.user.mfaEnabledAt && context.user.mfaTotpSecretEncrypted) {
    throw new HttpError(409, "La verificación en dos pasos ya está activa.");
  }

  const now = new Date();
  let secret: string;
  if (context.session.pendingMfaSecretEncrypted && context.session.pendingMfaSecretExpiresAt && context.session.pendingMfaSecretExpiresAt > now) {
    secret = decryptTotpSecret(context.session.pendingMfaSecretEncrypted);
  } else {
    secret = createTotpSecret();
    context.session.pendingMfaSecretEncrypted = encryptTotpSecret(secret);
    context.session.pendingMfaSecretExpiresAt = new Date(now.getTime() + SETUP_LIFETIME_MS);
    await saveSession(context);
  }

  return json({
    secret,
    uri: totpUri(secret, context.user.username),
    expiresAt: context.session.pendingMfaSecretExpiresAt,
  }, 200, { "Cache-Control": "no-store" });
}

async function verifySetup(request: Request): Promise<Response> {
  const context = await loadSession(request);
  requireCsrf(request, context);
  requirePasswordAuthenticated(context);
  requireAdminRole(context.user.role);
  const rate = await consumeRateLimit(request, "admin-mfa-setup", context.user._id, 8, 15 * 60_000);
  if (!rate.allowed) throw new HttpError(429, "Demasiados intentos. Espera antes de volver a probar.");
  const now = new Date();
  const encrypted = context.session.pendingMfaSecretEncrypted;
  if (!encrypted || !context.session.pendingMfaSecretExpiresAt || context.session.pendingMfaSecretExpiresAt <= now) {
    throw new HttpError(410, "La configuración ha caducado. Vuelve a iniciar el proceso.");
  }

  const input = await readJson(request);
  const code = requireString(input.code, "code", 6);
  const secret = decryptTotpSecret(encrypted);
  const step = totpStepForCode(secret, code, now.getTime());
  if (step === null) throw new HttpError(400, "El código no es correcto. Comprueba la hora de tu dispositivo.");

  const recoveryCodes = createRecoveryCodes();
  const { collections } = await getStore();
  const result = await collections.users.updateOne(
    { _id: context.user._id, role: "ADMIN", mfaEnabledAt: { $exists: false } },
    { $set: {
      mfaTotpSecretEncrypted: encrypted,
      mfaEnabledAt: now,
      mfaLastUsedStep: step,
      mfaRecoveryCodeHashes: recoveryCodes.map((value) => sha256(normalizeRecoveryCode(value))),
    } },
  );
  if (result.modifiedCount !== 1) throw new HttpError(409, "La verificación en dos pasos ya está configurada. Inicia sesión otra vez.");

  delete context.session.pendingMfaSecretEncrypted;
  delete context.session.pendingMfaSecretExpiresAt;
  const authenticated = await rotateSession(request, context, context.user, { mfaVerifiedAt: now });
  const headers = new Headers();
  addSessionCookies(headers, authenticated);
  await logAudit(context.user.email, "account.mfa_enabled", context.user._id);
  headers.set("Cache-Control", "no-store");
  return json({ recoveryCodes, next: nextPath(authenticated) }, 200, headers);
}

async function verifyLogin(request: Request): Promise<Response> {
  const context = await loadSession(request);
  requireCsrf(request, context);
  requirePasswordAuthenticated(context);
  requireAdminRole(context.user.role);
  if (!context.user.mfaEnabledAt || !context.user.mfaTotpSecretEncrypted) {
    throw new HttpError(409, "Primero tienes que configurar la verificación en dos pasos.");
  }

  const rate = await consumeRateLimit(request, "admin-mfa", context.user._id, 8, 15 * 60_000);
  if (!rate.allowed) throw new HttpError(429, "Demasiados intentos. Espera antes de volver a probar.");

  const input = await readJson(request);
  const submitted = requireString(input.code, "code", 32);
  const { collections } = await getStore();
  const normalizedRecoveryCode = normalizeRecoveryCode(submitted);
  let usedRecoveryCode = false;

  if (/^\d{6}$/.test(submitted)) {
    const secret = decryptTotpSecret(context.user.mfaTotpSecretEncrypted);
    const step = totpStepForCode(secret, submitted, Date.now());
    if (step === null) throw new HttpError(401, "El código no coincide. Comprueba la hora automática de tu dispositivo y vuelve a intentarlo.");
    if (context.user.mfaLastUsedStep !== undefined && step <= context.user.mfaLastUsedStep) {
      throw new HttpError(401, "Este código ya se ha utilizado. Espera a que aparezca uno nuevo y vuelve a intentarlo.");
    }
    const consumed = await collections.users.updateOne(
      {
        _id: context.user._id,
        mfaEnabledAt: { $exists: true },
        $or: [{ mfaLastUsedStep: { $lt: step } }, { mfaLastUsedStep: { $exists: false } }],
      },
      { $set: { mfaLastUsedStep: step } },
    );
    if (consumed.modifiedCount !== 1) throw new HttpError(401, "El código no es válido o ya se ha utilizado.");
  } else {
    if (!/^[A-F0-9]{16}$/.test(normalizedRecoveryCode)) throw new HttpError(401, "El código no es válido.");
    const recoveryHash = sha256(normalizedRecoveryCode);
    const consumed = await collections.users.updateOne(
      { _id: context.user._id, mfaRecoveryCodeHashes: recoveryHash },
      { $pull: { mfaRecoveryCodeHashes: recoveryHash } },
    );
    if (consumed.modifiedCount !== 1) throw new HttpError(401, "El código no es válido o ya se ha utilizado.");
    usedRecoveryCode = true;
  }

  const now = new Date();
  const authenticated = await rotateSession(request, context, context.user, { mfaVerifiedAt: now });
  const headers = new Headers();
  addSessionCookies(headers, authenticated);
  await logAudit(context.user.email, usedRecoveryCode ? "account.mfa_recovery_code_used" : "account.mfa_verified", context.user._id);
  headers.set("Cache-Control", "no-store");
  return json({ next: nextPath(authenticated) }, 200, headers);
}

function nextPath(context: Awaited<ReturnType<typeof rotateSession>>): string {
  if (isAuthorizationRequestCurrent(context.session.requestedAuthorization)) return authorizationPath(context.session.requestedAuthorization);
  return "/admin";
}

function requireAdminRole(role: string): void {
  if (role !== "ADMIN") throw new HttpError(403, "La verificación en dos pasos solo está disponible para administradores.");
}
