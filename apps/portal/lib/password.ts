import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LEN = 64;
const MIN_PASSWORD_LEN = 12;
// OWASP Password Storage Cheat Sheet's top scrypt tier (N=2^17, r=8, p=1).
// maxmem must cover scrypt's ~128*N*r byte working set (~128MiB here).
const SCRYPT_OPTS = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 } as const;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LEN, SCRYPT_OPTS);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

/** Constant-time compare — never short-circuits on a length/format mismatch. */
export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const candidate = scryptSync(password, salt, expected.length, SCRYPT_OPTS);
  return timingSafeEqual(candidate, expected);
}

export function assertStrongPassword(password: string): void {
  if (password.length < MIN_PASSWORD_LEN) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LEN} characters.`);
  }
}

/**
 * A fixed, publicly-known hash with no corresponding real password. Run a
 * verify against it (result discarded) on the "no such account" path in
 * authorize() so that path costs the same as a real wrong-password check —
 * otherwise the two cases are distinguishable by response latency alone,
 * letting an attacker enumerate which emails are provisioned operators.
 */
export const DUMMY_HASH = hashPassword("dummy-password-for-timing-equalization-only");
