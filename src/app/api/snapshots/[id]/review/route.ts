import { z } from "zod";

import { invalidateCoachCache } from "@/lib/ai/coach";
import { acceptAllPending, applyDecisions, createKpiFromObservation } from "@/lib/extraction/review";
import { ok, parseJson, withAuth } from "@/lib/http/api";

const DecisionSchema = z.object({
  observationId: z.string().min(1),
  action: z.enum(["ACCEPT", "REJECT", "CORRECT"]),
  value: z.number().finite().optional(),
  kpiId: z.string().min(1).optional(),
});

const BodySchema = z.union([
  z.object({ mode: z.literal("acceptAll") }),
  z.object({
    mode: z.literal("createKpi"),
    observationId: z.string().min(1),
    key: z.string().max(60).optional(),
    displayName: z.string().max(120).optional(),
    category: z.string().max(60).optional(),
    weight: z.number().positive().max(100).optional(),
  }),
  z.object({ mode: z.literal("decisions").optional(), decisions: z.array(DecisionSchema).min(1).max(200) }),
]);

/** POST /api/snapshots/:id/review — human-in-the-loop verification. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  return withAuth(async ({ user, request: req }) => {
    const body = await parseJson(req, BodySchema);

    if ("mode" in body && body.mode === "acceptAll") {
      const outcome = await acceptAllPending(user.id, id);
      if (outcome.snapshotStatus === "CONFIRMED") await invalidateCoachCache(user.id);
      return ok(outcome);
    }

    if ("mode" in body && body.mode === "createKpi") {
      const created = await createKpiFromObservation(user.id, body.observationId, {
        key: body.key,
        displayName: body.displayName,
        category: body.category,
        weight: body.weight,
      });
      return ok({ ...created });
    }

    const outcome = await applyDecisions(user.id, id, body.decisions);
    if (outcome.snapshotStatus === "CONFIRMED") await invalidateCoachCache(user.id);
    return ok(outcome);
  })(request);
}
