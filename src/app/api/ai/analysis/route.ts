import { z } from "zod";

import { runDeepAnalysis } from "@/lib/ai/coach";
import { env } from "@/lib/env";
import { fail, ok, parseJson, withAuth } from "@/lib/http/api";
import { clientKey, rateLimit } from "@/lib/http/rate-limit";

const BodySchema = z.object({ focus: z.string().trim().max(500).optional() }).default({});

/**
 * POST /api/ai/analysis — the deliberate, expensive path.
 *
 * This is the one place the deep-analysis model runs, and only when the user
 * asks for it. It is rate limited more tightly than routine AI.
 */
export const POST = withAuth(async ({ user, request }) => {
  const limit = rateLimit(clientKey(request, `deep:${user.id}`), 6, 3_600_000);
  if (!limit.allowed) {
    return fail(429, {
      error: "Deep analysis is limited to a few runs per hour.",
      detail: `Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minutes.`,
    });
  }

  const body = request.headers.get("content-type")?.includes("application/json")
    ? await parseJson(request, BodySchema)
    : {};

  const result = await runDeepAnalysis(user.id, user.timezone, body.focus);
  return ok(result);
});
