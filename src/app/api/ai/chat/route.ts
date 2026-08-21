import { z } from "zod";

import { askQuestion } from "@/lib/ai/coach";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { fail, ok, parseJson, withAuth } from "@/lib/http/api";
import { clientKey, rateLimit } from "@/lib/http/rate-limit";

const BodySchema = z.object({ question: z.string().trim().min(2).max(1000) });

export const GET = withAuth(async ({ user }) => {
  const messages = await prisma.chatMessage.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    take: 100,
    select: { id: true, role: true, content: true, createdAt: true, model: true },
  });
  return ok({ messages });
});

/** POST /api/ai/chat — natural-language questions over the user's own numbers. */
export const POST = withAuth(async ({ user, request }) => {
  const limit = rateLimit(clientKey(request, `ai:${user.id}`), env().RATE_LIMIT_AI_PER_HOUR, 3_600_000);
  if (!limit.allowed) {
    return fail(429, {
      error: "AI request limit reached for this hour.",
      detail: `Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minutes.`,
    });
  }

  const body = await parseJson(request, BodySchema);
  const result = await askQuestion(user.id, user.timezone, body.question);
  return ok(result);
});

export const DELETE = withAuth(async ({ user }) => {
  const result = await prisma.chatMessage.deleteMany({ where: { userId: user.id } });
  return ok({ deleted: result.count });
});
