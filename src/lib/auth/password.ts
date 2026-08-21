import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { promisify } from "node:util";

// promisify drops the options overload, so it is reinstated here.
const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/**
 * Password hashing with scrypt from Node's standard library — memory-hard,
 * audited, and no native dependency to break on a VPS rebuild.
 *
 * N=2^15 with r=8 costs roughly 100ms and 32MB per hash, which is the right
 * trade-off for a login endpoint.
 */
const PARAMS = { N: 32768, r: 8, p: 1, keyLength: 64, saltLength: 16 } as const;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(PARAMS.saltLength);
  const derived = await scrypt(password.normalize("NFKC"), salt, PARAMS.keyLength, {
    N: PARAMS.N,
    r: PARAMS.r,
    p: PARAMS.p,
    // scrypt needs headroom above the default 32MB limit at these parameters.
    maxmem: 256 * 1024 * 1024,
  });

  return ["scrypt", PARAMS.N, PARAMS.r, PARAMS.p, salt.toString("base64"), derived.toString("base64")].join(
    "$",
  );
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts;
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  let expected: Buffer;
  let salt: Buffer;
  try {
    expected = Buffer.from(hashRaw ?? "", "base64");
    salt = Buffer.from(saltRaw ?? "", "base64");
  } catch {
    return false;
  }
  if (expected.length === 0 || salt.length === 0) return false;

  const derived = await scrypt(password.normalize("NFKC"), salt, expected.length, {
    N,
    r,
    p,
    maxmem: 256 * 1024 * 1024,
  });

  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export interface PasswordPolicyResult {
  ok: boolean;
  message?: string;
}

export function checkPasswordPolicy(password: string): PasswordPolicyResult {
  if (password.length < 12) {
    return { ok: false, message: "Use at least 12 characters." };
  }
  if (password.length > 200) {
    return { ok: false, message: "Password is too long (200 characters maximum)." };
  }
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
    return { ok: false, message: "Include at least one letter and one number." };
  }
  return { ok: true };
}
