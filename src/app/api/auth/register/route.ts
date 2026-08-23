import { z } from "zod";

import { createSession } from "@/lib/auth/session";
import { checkPasswordPolicy, hashPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { fail, ok, parseJson, toErrorResponse } from "@/lib/http/api";
import { clientKey, rateLimit } from "@/lib/http/rate-limit";
import { logger } from "@/lib/logger";
import { seedDefaultKpis } from "@/lib/onboarding";

const BodySchema = z.object({
  email: z.string().trim().toLowerCase().min(3).max(200),
  password: z.string().min(1).max(200),
  name: z.string().trim().max(120).optional(),
  timezone: z.string().trim().min(1).max(80).default("America/New_York"),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const limit = rateLimit(clientKey(request, "register"), 5, 15 * 60_000);
    if (!limit.allowed) {
      return fail(429, {
        error: "Too many attempts.",
        detail: `Try again in ${limit.retryAfterSeconds} seconds.`,
      });
    }

    const body = await parseJson(request, BodySchema);
    if (!body.email.includes("@")) {
      return fail(400, { error: "Enter a valid email address.", fields: { email: "Invalid email." } });
    }

    const policy = checkPasswordPolicy(body.password);
    if (!policy.ok) {
      return fail(400, { error: policy.message ?? "Password is too weak.", fields: { password: policy.message ?? "" } });
    }

    const existingCount = await prisma.user.count();
    // The first account always succeeds; later ones need registration open.
    if (existingCount > 0 && !env().ALLOW_REGISTRATION) {
      return fail(403, {
        error: "Registration is closed.",
        detail: "This dashboard already has an owner. Set ALLOW_REGISTRATION=true to add another account.",
      });
    }

    const duplicate = await prisma.user.findUnique({ where: { email: body.email }, select: { id: true } });
    if (duplicate) {
      return fail(409, { error: "An account with that email already exists.", fields: { email: "Already registered." } });
    }

    const user = await prisma.user.create({
      data: {
        email: body.email,
        passwordHash: await hashPassword(body.password),
        name: body.name || null,
        timezone: body.timezone,
        role: existingCount === 0 ? "OWNER" : "MEMBER",
      },
      select: { id: true, email: true, name: true },
    });

    await seedDefaultKpis(user.id);
    await createSession(user.id, {
      userAgent: request.headers.get("user-agent"),
      ipAddress: request.headers.get("x-forwarded-for"),
    });
    await logger.info({ userId: user.id, category: "auth", message: "Account created." });

    return ok({ user }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error, request);
  }
}
