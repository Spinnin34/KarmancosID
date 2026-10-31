import nodemailer, { type Transporter } from "nodemailer";
import { getStore } from "./storage";
import { randomToken, sha256 } from "./security";
import type { IdentityUser } from "./types";

let transporter: Transporter | null | undefined;

function getTransporter() {
  if (transporter !== undefined) return transporter;
  const host = process.env.SPRING_MAIL_HOST;
  if (!host) return (transporter = null);
  const port = Number(process.env.SPRING_MAIL_PORT || 587);
  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: process.env.SPRING_MAIL_USERNAME
      ? { user: process.env.SPRING_MAIL_USERNAME, pass: process.env.SPRING_MAIL_PASSWORD || "" }
      : undefined,
    requireTLS: port !== 465,
    connectionTimeout: 8_000,
    greetingTimeout: 8_000,
    socketTimeout: 12_000,
  });
  return transporter;
}

export async function sendActionEmail(user: IdentityUser, purpose: "verify" | "reset") {
  const raw = randomToken(32);
  const now = new Date();
  const lifetime = purpose === "verify" ? 24 * 60 * 60_000 : 30 * 60_000;
  const expiresAt = new Date(now.getTime() + lifetime);
  const { collections } = await getStore();
  await collections.actionTokens.deleteMany({ userId: user._id, purpose });
  await collections.actionTokens.insertOne({
    _id: sha256(raw), userId: user._id, targetEmail: user.email, purpose, expiresAt,
    purgeAt: new Date(expiresAt.getTime() + 24 * 60 * 60_000),
  });

  const mailer = getTransporter();
  if (!mailer) {
    console.error("Account email delivery is disabled because SMTP is not configured.");
    return;
  }
  const baseUrl = (process.env.KARMANCOS_PUBLIC_BASE_URL || process.env.KARMANCOS_ISSUER || process.env.PUBLIC_IDENTITY_ISSUER || "").replace(/\/+$/, "");
  if (!baseUrl) {
    console.error("Account email delivery is disabled because the public site URL is not configured.");
    return;
  }
  const route = purpose === "verify" ? "/verificar-correo?token=" : "/restablecer-contrasena?token=";
  const subject = purpose === "verify" ? "Confirma tu correo de Karmancos ID" : "Recupera tu cuenta de Karmancos ID";
  const intro = purpose === "verify"
    ? "Confirma tu correo electrónico para completar la configuración de tu cuenta."
    : "Solicitaste cambiar la contraseña. Si no fuiste tú, ignora este mensaje.";
  try {
    await mailer.sendMail({
      from: process.env.KARMANCOS_MAIL_FROM || "no-reply@karmancos.com",
      to: user.email,
      subject,
      text: `${intro}\n\n${baseUrl}${route}${encodeURIComponent(raw)}\n\nSi no solicitaste esta acción, puedes ignorar este mensaje.`,
    });
  } catch (error) {
    console.error("Account email delivery failed.", error instanceof Error ? error.name : "Unknown error");
  }
}

export async function consumeActionToken(raw: string, purpose: "verify" | "reset") {
  const { collections } = await getStore();
  if (raw.length < 40 || raw.length > 100) return null;
  return collections.actionTokens.findOneAndDelete({
    _id: sha256(raw), purpose, expiresAt: { $gt: new Date() },
  });
}
