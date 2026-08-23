import { z } from "zod";

import { invalidateCoachCache } from "@/lib/ai/coach";
import { correctObservation } from "@/lib/extraction/review";
import { prisma } from "@/lib/db";
import { fail, ok, parseJson, withAuth } from "@/lib/http/api";

const PatchSchema = z.object({
  value: z.number().finite(),
});

/**
 * PATCH /api/observations/:id — manual correction of an extracted value.
 *
 * The model's original reading is preserved in `aiValue`; only the effective
 * value changes. That is what makes extraction accuracy measurable.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  return withAuth(async ({ user, request: req }) => {
    const body = await parseJson(req, PatchSchema);
    const existing = await prisma.metricObservation.findFirst({
      where: { id, userId: user.id },
      select: { id: true },
    });
    if (!existing) return fail(404, { error: "Reading not found." });

    await correctObservation(user.id, id, body.value);
    await invalidateCoachCache(user.id);

    const observation = await prisma.metricObservation.findUnique({
      where: { id },
      include: { kpi: { select: { key: true, displayName: true } } },
    });
    return ok({ observation });
  })(request);
}
