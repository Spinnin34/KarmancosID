import bcrypt from "bcryptjs";
import { sha256 } from "./security";

const PASSWORD_HASH_PREFIX = "bcrypt-sha256-v1$";
const PASSWORD_HASH_ROUNDS = 12;

export function hasLegacyPasswordHash(storedHash: string): boolean {
  return !storedHash.startsWith(PASSWORD_HASH_PREFIX);
}

export async function hashPassword(password: string): Promise<string> {
  return `${PASSWORD_HASH_PREFIX}${await bcrypt.hash(sha256(password), PASSWORD_HASH_ROUNDS)}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (!storedHash.startsWith(PASSWORD_HASH_PREFIX)) return bcrypt.compare(password, storedHash);
  return bcrypt.compare(sha256(password), storedHash.slice(PASSWORD_HASH_PREFIX.length));
}
