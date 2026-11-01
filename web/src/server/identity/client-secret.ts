import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const DERIVED_KEY_FORMAT = "v1h";
const DEDICATED_KEY_FORMAT = "v1k";

export function encryptClientSecret(secret: string): string {
  const iv = randomBytes(12);
  const format = process.env.KARMANCOS_CLIENT_SECRET_ENCRYPTION_KEY_B64 ? DEDICATED_KEY_FORMAT : DERIVED_KEY_FORMAT;
  const cipher = createCipheriv("aes-256-gcm", clientSecretEncryptionKey(format), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [format, iv, cipher.getAuthTag(), ciphertext]
    .map((part) => typeof part === "string" ? part : part.toString("base64url"))
    .join(".");
}

export function decryptClientSecret(value: string): string {
  const [version, ivValue, tagValue, ciphertextValue, extra] = value.split(".");
  if ((version !== DEDICATED_KEY_FORMAT && version !== DERIVED_KEY_FORMAT) || !ivValue || !tagValue || !ciphertextValue || extra) {
    throw new Error("Invalid encrypted OAuth client secret.");
  }
  const decipher = createDecipheriv("aes-256-gcm", clientSecretEncryptionKey(version), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function clientSecretEncryptionKey(format: string): Buffer {
  const encoded = process.env.KARMANCOS_CLIENT_SECRET_ENCRYPTION_KEY_B64;
  if (format === DEDICATED_KEY_FORMAT) {
    if (!encoded) throw new Error("OAuth client secret encryption key is not configured.");
    const key = Buffer.from(encoded, "base64");
    if (key.length !== 32) throw new Error("OAuth client secret encryption key must decode to 32 bytes.");
    return key;
  }

  const subjectSecret = process.env.KARMANCOS_SUBJECT_HMAC_SECRET;
  if (!subjectSecret || subjectSecret.length < 32) {
    throw new Error("OAuth client secret encryption needs a dedicated key or the stable subject HMAC secret.");
  }
  return Buffer.from(hkdfSync(
    "sha256",
    Buffer.from(subjectSecret, "utf8"),
    Buffer.from("Karmancos ID", "utf8"),
    Buffer.from("OAuth client secret encryption v1", "utf8"),
    32,
  ));
}
