import { z } from "zod";

import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { fail, ok, parseJson, toErrorResponse } from "@/lib/http/api";
import { clearRateLimit, clientKey, rateLimit } from "@/lib/http/rate-limit";
import { logger } from "@/lib/logger";

const BodySchema = z.object({
  email: z.string().trim().toLowerCase().min(1).max(200),
  password: z.string().min(1).max(200),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const key = clientKey(request, "login");
    const limit = rateLimit(key, env().RATE_LIMIT_LOGIN_PER_15MIN, 15 * 60_000);
    if (!limit.allowed) {
      return fail(429, {
        error: "Too many sign-in attempts.",
        detail: `Try again in ${limit.retryAfterSeconds} seconds.`,
      });
    }

    const body = await parseJson(request, BodySchema);
    const user = await prisma.user.findUnique({
      where: { email: body.email },
      select: { id: true, email: true, name: true, passwordHash: true },
    });

    // Same failure message and comparable timing whether or not the account
    // exists, so this endpoint cannot be used to enumerate users.
    const valid = user ? await verifyPassword(body.password, user.passwordHash) : false;
    if (!user || !valid) {
      await logger.warn({ category: "auth", message: "Failed sign-in attempt.", meta: { email: body.email } });
      return fail(401, { error: "Email or password is incorrect." });
    }

    clearRateLimit(key);
    await createSession(user.id, {
      userAgent: request.headers.get("user-agent"),
      ipAddress: request.headers.get("x-forwarded-for"),
    });

    return ok({ user: { id: user.id, email: user.email, name: user.name } });
  } catch (error) {
    return toErrorResponse(error, request);
  }
}
