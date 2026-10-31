import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const STEP_SECONDS = 30;
const DIGITS = 6;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function createTotpSecret(): string {
  return encodeBase32(randomBytes(20));
}

export function totpUri(secret: string, account: string): string {
  const label = `Karmancos ID:${account}`;
  const query = new URLSearchParams({ secret, issuer: "Karmancos ID", algorithm: "SHA1", digits: String(DIGITS), period: String(STEP_SECONDS) });
  return `otpauth://totp/${encodeURIComponent(label)}?${query.toString()}`;
}

export function totpStepForCode(secret: string, code: string, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const currentStep = Math.floor(now / 1000 / STEP_SECONDS);
  const candidate = Buffer.from(code);
  for (const step of [currentStep, currentStep - 1, currentStep + 1]) {
    const expected = Buffer.from(totpForStep(secret, step));
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) return step;
  }
  return null;
}

export function totpForStep(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", decodeBase32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % (10 ** DIGITS)).padStart(DIGITS, "0");
}

export function createRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => randomBytes(8).toString("hex").toUpperCase().match(/.{4}/g)!.join("-"));
}

export function normalizeRecoveryCode(code: string): string {
  return code.replace(/[\s-]/g, "").toUpperCase();
}

export function encryptTotpSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", mfaEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url")).join(".");
}

export function decryptTotpSecret(value: string): string {
  const [ivValue, tagValue, ciphertextValue, extra] = value.split(".");
  if (!ivValue || !tagValue || !ciphertextValue || extra) throw new Error("Invalid encrypted MFA secret.");
  const decipher = createDecipheriv("aes-256-gcm", mfaEncryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, "base64url")), decipher.final()]).toString("utf8");
}

function mfaEncryptionKey(): Buffer {
  const encoded = process.env.KARMANCOS_MFA_ENCRYPTION_KEY_B64;
  if (!encoded) throw new Error("Administrator MFA encryption key is not configured.");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error("Administrator MFA encryption key must decode to 32 bytes.");
  return key;
}

function encodeBase32(value: Buffer): string {
  let output = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of value) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) output += BASE32_ALPHABET[(buffer << (5 - bits)) & 31];
  return output;
}

function decodeBase32(value: string): Buffer {
  const normalized = value.toUpperCase().replace(/=+$/g, "");
  let buffer = 0;
  let bits = 0;
  const output: number[] = [];
  for (const character of normalized) {
    const digit = BASE32_ALPHABET.indexOf(character);
    if (digit < 0) throw new Error("Invalid base32 MFA secret.");
    buffer = (buffer << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      output.push((buffer >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}
