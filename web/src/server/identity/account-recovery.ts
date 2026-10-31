import bcrypt from "bcryptjs";
import { getStore } from "./storage";
import { removeGrantsForPrincipal } from "./client-repository";
import { consumeRateLimit, logAudit } from "./operations";
import { clearAuthCookies, loadSession, requireAdmin, requireCsrf, type SessionContext } from "./session";
import { json, readJson, requireString } from "./http";
import { normalizeEmail, randomToken, sha256 } from "./security";
import { HttpError } from "./types";

const RECOVERY_LIFETIME_MS = 30 * 60_000;

export async function adminRecoveryEndpoint(request: Request, path: string, context: SessionContext | null): Promise<Response | null> {
  const match = path.match(/^\/api\/admin\/users\/([^/]+)\/recovery-code$/);
  if (request.method !== "POST" || !match) return null;

  requireCsrf(request, context);
  requireAdmin(context);
  const userId = decodeURIComponent(match[1]);
  if (userId === context.user._id) throw new HttpError(409, "Pide a otra persona administradora que gestione tu recuperación.");

  const rate = await consumeRateLimit(request, "admin-account-recovery", userId, 3, 60 * 60_000);
  if (!rate.allowed) throw new HttpError(429, "Se han emitido varios códigos para esta cuenta. Prueba más tarde.");

  const { collections } = await getStore();
  const user = await collections.users.findOne({ _id: userId, active: true });
  if (!user) throw new HttpError(404, "No se encontró una cuenta activa con ese identificador.");

  const now = new Date();
  const code = randomToken(32);
  await collections.accountRecoveryTokens.deleteMany({ userId });
  await collections.accountRecoveryTokens.insertOne({
    _id: sha256(`account-recovery\0${code}`), userId, issuedBy: context.user._id,
    createdAt: now, expiresAt: new Date(now.getTime() + RECOVERY_LIFETIME_MS),
  });
  await logAudit(context.user.email, "account.recovery_code_issued", user._id);
  return json({ recoveryCode: code, expiresAt: new Date(now.getTime() + RECOVERY_LIFETIME_MS).toISOString() }, 201, { "Cache-Control": "no-store" });
}

export async function accountRecoveryEndpoint(request: Request, path: string): Promise<Response | null> {
  if (request.method !== "POST" || path !== "/api/auth/recovery/complete") return null;

  const context = await loadSession(request);
  requireCsrf(request, context);
  const input = await readJson(request);
  const recoveryCode = requireString(input.recoveryCode, "recoveryCode", 128);
  const newPassword = requireString(input.newPassword, "newPassword", 128);
  if (newPassword.length < 12) throw new HttpError(400, "La contraseña debe tener entre 12 y 128 caracteres.");

  const codeHash = sha256(`account-recovery\0${recoveryCode}`);
  const rate = await consumeRateLimit(request, "account-recovery", codeHash, 5, 15 * 60_000);
  if (!rate.allowed) throw new HttpError(429, "Demasiados intentos. Espera antes de volver a probar.");

  const { collections } = await getStore();
  const candidate = await collections.accountRecoveryTokens.findOne({ _id: codeHash, expiresAt: { $gt: new Date() } });
  if (!candidate) throw new HttpError(400, "El código no es válido o ha caducado.");
  const user = await collections.users.findOne({ _id: candidate.userId, active: true });
  if (!user) throw new HttpError(400, "El código no es válido o ha caducado.");

  const passwordHash = await bcrypt.hash(newPassword, 12);
  const consumed = await collections.accountRecoveryTokens.findOneAndDelete({ _id: codeHash, expiresAt: { $gt: new Date() } });
  if (!consumed) throw new HttpError(400, "El código no es válido o ya se ha usado.");

  await collections.users.updateOne({ _id: user._id }, { $set: { passwordHash } });
  await Promise.all([
    collections.sessions.deleteMany({ email: normalizeEmail(user.email) }),
    removeGrantsForPrincipal(user.email),
    collections.accountRecoveryTokens.deleteMany({ userId: user._id }),
  ]);
  await logAudit(user.email, "account.password_reset_admin_assisted", user._id);
  const headers = new Headers();
  clearAuthCookies(headers);
  return json({ message: "Contraseña actualizada. Inicia sesión con la nueva contraseña." }, 200, headers);
}
