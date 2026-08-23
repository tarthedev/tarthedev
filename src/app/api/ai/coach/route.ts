import { z } from "zod";

import { getCoachBrief } from "@/lib/ai/coach";
import { env } from "@/lib/env";
import { fail, ok, parseJson, withAuth } from "@/lib/http/api";
import { clientKey, rateLimit } from "@/lib/http/rate-limit";

const BodySchema = z.object({ force: z.boolean().optional() }).default({});

/**
 * POST /api/ai/coach
 *
 * Returns the cached brief unless the underlying numbers changed or a refresh
 * was explicitly requested — opening the dashboard does not spend money.
 */
export const POST = withAuth(async ({ user, request }) => {
  const limit = rateLimit(clientKey(request, `ai:${user.id}`), env().RATE_LIMIT_AI_PER_HOUR, 3_600_000);
  if (!limit.allowed) {
    return fail(429, {
      error: "AI request limit reached for this hour.",
      detail: `Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minutes.`,
    });
  }

  const body = request.headers.get("content-type")?.includes("application/json")
    ? await parseJson(request, BodySchema)
    : {};

  const result = await getCoachBrief(user.id, user.timezone, { force: body.force });
  return ok(result);
});
