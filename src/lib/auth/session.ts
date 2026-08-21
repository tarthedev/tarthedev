import { createHash, randomBytes, timingSafeEqual, createHmac } from "node:crypto";
import { cookies } from "next/headers";

import { prisma } from "@/lib/db";
import { env } from "@/lib/env";

export const SESSION_COOKIE = "kpi_session";

interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  timezone: string;
  role: "OWNER" | "MEMBER";
  onboardedAt: Date | null;
}

/** Only the hash is stored, so a database dump does not yield usable sessions. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * The cookie carries `<token>.<hmac>`. The HMAC lets an obviously forged cookie
 * be rejected without a database round-trip; the token itself is still verified
 * against the sessions table.
 */
function sign(token: string): string {
  return createHmac("sha256", env().SESSION_SECRET).update(token).digest("base64url");
}

function parseCookieValue(value: string): string | null {
  const separator = value.lastIndexOf(".");
  if (separator <= 0) return null;

  const token = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  const expected = sign(token);

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return token;
}

export async function createSession(
  userId: string,
  meta: { userAgent?: string | null; ipAddress?: string | null } = {},
): Promise<void> {
  const config = env();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + config.SESSION_TTL_DAYS * 86_400_000);

  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      userAgent: meta.userAgent?.slice(0, 500) ?? null,
      ipAddress: meta.ipAddress?.slice(0, 100) ?? null,
    },
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, `${token}.${sign(token)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.APP_URL.startsWith("https://"),
    path: "/",
    expires: expiresAt,
  });
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (!raw) return null;

  const token = parseCookieValue(raw);
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      expiresAt: true,
      lastSeenAt: true,
      user: {
        select: { id: true, email: true, name: true, timezone: true, role: true, onboardedAt: true },
      },
    },
  });
  if (!session) return null;

  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }

  // Throttled touch — one write per hour rather than one per request.
  if (Date.now() - session.lastSeenAt.getTime() > 3_600_000) {
    await prisma.session
      .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
      .catch(() => undefined);
  }

  return session.user;
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  store.delete(SESSION_COOKIE);
  if (!raw) return;

  const token = parseCookieValue(raw);
  if (!token) return;
  await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

/** Housekeeping — expired rows serve no purpose. */
export async function pruneExpiredSessions(): Promise<number> {
  const result = await prisma.session.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  return result.count;
}

export type { SessionUser };
