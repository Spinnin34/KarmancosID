import assert from "node:assert/strict";
import test from "node:test";
import {
  createRecoveryCodes,
  decryptTotpSecret,
  encryptTotpSecret,
  normalizeRecoveryCode,
  totpForStep,
  totpStepForCode,
} from "../src/server/identity/totp";

const sha1Secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

test("TOTP matches the RFC 6238 SHA-1 vectors with six digits", () => {
  const vectors = [
    [59, "287082"],
    [1_111_111_109, "081804"],
    [1_111_111_111, "050471"],
    [1_234_567_890, "005924"],
    [2_000_000_000, "279037"],
    [20_000_000_000, "353130"],
  ] as const;

  for (const [timestamp, expected] of vectors) {
    const step = Math.floor(timestamp / 30);
    assert.equal(totpForStep(sha1Secret, step), expected);
    assert.equal(totpStepForCode(sha1Secret, expected, timestamp * 1000), step);
  }
});

test("recovery codes are unique, normalized and generated in printable groups", () => {
  const codes = createRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  assert.ok(codes.every((code) => /^[A-F0-9]{4}(?:-[A-F0-9]{4}){3}$/.test(code)));
  assert.equal(normalizeRecoveryCode(" a1b2-c3d4 e5f6-7890 "), "A1B2C3D4E5F67890");
});

test("TOTP secrets use authenticated encryption", () => {
  const previous = process.env.KARMANCOS_MFA_ENCRYPTION_KEY_B64;
  process.env.KARMANCOS_MFA_ENCRYPTION_KEY_B64 = Buffer.alloc(32, 7).toString("base64");
  try {
    const encrypted = encryptTotpSecret(sha1Secret);
    assert.equal(decryptTotpSecret(encrypted), sha1Secret);
    const [iv, tag, ciphertext] = encrypted.split(".");
    const tampered = `${iv}.${tag}.${ciphertext.slice(0, -1)}${ciphertext.endsWith("A") ? "B" : "A"}`;
    assert.throws(() => decryptTotpSecret(tampered));
  } finally {
    if (previous === undefined) delete process.env.KARMANCOS_MFA_ENCRYPTION_KEY_B64;
    else process.env.KARMANCOS_MFA_ENCRYPTION_KEY_B64 = previous;
  }
});
