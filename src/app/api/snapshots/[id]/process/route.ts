import { z } from "zod";

import { invalidateCoachCache } from "@/lib/ai/coach";
import { ok, parseJson, withAuth } from "@/lib/http/api";
import { env } from "@/lib/env";
import { fail } from "@/lib/http/api";
import { clientKey, rateLimit } from "@/lib/http/rate-limit";
import { processSnapshot } from "@/lib/extraction/pipeline";

const BodySchema = z
  .object({
    /** Skips straight to the escalation model, for a retry the user asked for. */
    forceEscalation: z.boolean().optional(),
  })
  .default({});

/** POST /api/snapshots/:id/process — runs the extraction pipeline. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  return withAuth(async ({ user, request: req }) => {
    const limit = rateLimit(clientKey(req, `ai:${user.id}`), env().RATE_LIMIT_AI_PER_HOUR, 3_600_000);
    if (!limit.allowed) {
      return fail(429, {
        error: "AI request limit reached for this hour.",
        detail: `Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minutes.`,
      });
    }

    const body = req.headers.get("content-type")?.includes("application/json")
      ? await parseJson(req, BodySchema)
      : {};

    const result = await processSnapshot(user.id, id, user.timezone, {
      forceEscalation: body.forceEscalation,
    });

    if (result.status === "CONFIRMED") await invalidateCoachCache(user.id);
    return ok(result, { status: result.status === "FAILED" ? 422 : 200 });
  })(request);
}
