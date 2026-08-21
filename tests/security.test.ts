import { describe, expect, it } from "vitest";
import { checkPasswordPolicy, hashPassword, verifyPassword } from "@/lib/auth/password";
import { assertSafeKey, StorageError } from "@/lib/storage/types";
import { clearRateLimit, rateLimit } from "@/lib/http/rate-limit";
import { sniffMime } from "@/lib/images";


describe("password hashing", () => {
  it("round-trips a password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
    expect(await verifyPassword("wrong password entirely", hash)).toBe(false);
  }, 20000);

  it("never stores the password and always salts", async () => {
    const password = "another-good-password-1";
    const a = await hashPassword(password);
    const b = await hashPassword(password);

    expect(a).not.toContain(password);
    // Distinct salts mean identical passwords produce different hashes.
    expect(a).not.toBe(b);
    expect(await verifyPassword(password, b)).toBe(true);
  }, 30000);

  it("normalises unicode so an equivalent password still verifies", async () => {
    // "é" composed vs decomposed are the same character to a user.
    const hash = await hashPassword("café-password-1");
    expect(await verifyPassword("café-password-1", hash)).toBe(true);
  }, 20000);

  it("rejects a malformed stored hash without throwing", async () => {
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
    expect(await verifyPassword("x", "scrypt$1$2$3$4")).toBe(false);
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "scrypt$32768$8$1$$")).toBe(false);
  });

  it("enforces a usable password policy", () => {
    expect(checkPasswordPolicy("short").ok).toBe(false);
    expect(checkPasswordPolicy("alllettersnodigits").ok).toBe(false);
    expect(checkPasswordPolicy("123456789012345").ok).toBe(false);
    expect(checkPasswordPolicy("good-password-1").ok).toBe(true);
  });
});

describe("storage key safety", () => {
  it("rejects traversal, absolute paths and null bytes", () => {
    for (const key of ["../etc/passwd", "/etc/passwd", "a/../../b", "a\0b", "a\\b", ""]) {
      expect(() => assertSafeKey(key)).toThrow(StorageError);
    }
  });

  it("accepts the keys the app actually generates", () => {
    expect(() => assertSafeKey("user123/snap456/abc-def.png")).not.toThrow();
  });
});

describe("image sniffing", () => {
  it("identifies formats by magic bytes, not by the claimed content type", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]);

    expect(sniffMime(png)).toBe("image/png");
    expect(sniffMime(jpeg)).toBe("image/jpeg");
    expect(sniffMime(webp)).toBe("image/webp");
  });

  it("rejects non-images, including a renamed script", () => {
    expect(sniffMime(Buffer.from("<?php system($_GET[0]); ?>"))).toBeNull();
    expect(sniffMime(Buffer.from("GIF89a"))).toBeNull();
    expect(sniffMime(Buffer.alloc(4))).toBeNull();
  });
});

describe("rate limiting", () => {
  it("allows up to the limit then blocks", () => {
    const key = `test-${Math.random()}`;
    for (let i = 0; i < 3; i++) expect(rateLimit(key, 3, 60_000).allowed).toBe(true);

    const blocked = rateLimit(key, 3, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("clears a window after a successful attempt", () => {
    const key = `test-${Math.random()}`;
    rateLimit(key, 1, 60_000);
    expect(rateLimit(key, 1, 60_000).allowed).toBe(false);

    clearRateLimit(key);
    expect(rateLimit(key, 1, 60_000).allowed).toBe(true);
  });

  it("keeps separate counters per key", () => {
    const a = `a-${Math.random()}`;
    const b = `b-${Math.random()}`;
    rateLimit(a, 1, 60_000);
    expect(rateLimit(a, 1, 60_000).allowed).toBe(false);
    expect(rateLimit(b, 1, 60_000).allowed).toBe(true);
  });
});
