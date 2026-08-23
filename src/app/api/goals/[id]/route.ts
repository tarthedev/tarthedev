import { z } from "zod";

import { invalidateCoachCache } from "@/lib/ai/coach";
import { prisma } from "@/lib/db";
import { fail, ok, parseJson, withAuth } from "@/lib/http/api";
import { dateKeyToUtc, isDateKey } from "@/lib/kpi/dates";

const PatchSchema = z.object({
  targetValue: z.number().finite().nonnegative().optional(),
  minimumValue: z.number().finite().nonnegative().nullable().optional(),
  stretchValue: z.number().finite().nonnegative().nullable().optional(),
  priority: z.number().int().min(0).max(999).optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  active: z.boolean().optional(),
  periodStart: z.string().refine(isDateKey).optional(),
  periodEnd: z.string().refine(isDateKey).optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  return withAuth(async ({ user, request: req }) => {
    const body = await parseJson(req, PatchSchema);
    const existing = await prisma.goal.findFirst({ where: { id, userId: user.id } });
    if (!existing) return fail(404, { error: "Goal not found." });

    const target = body.targetValue ?? existing.targetValue;
    const minimum = body.minimumValue === undefined ? existing.minimumValue : body.minimumValue;
    const stretch = body.stretchValue === undefined ? existing.stretchValue : body.stretchValue;

    if (minimum !== null && minimum > target) {
      return fail(400, { error: "Minimum cannot be above the target.", fields: { minimumValue: "Too high." } });
    }
    if (stretch !== null && stretch < target) {
      return fail(400, { error: "Stretch cannot be below the target.", fields: { stretchValue: "Too low." } });
    }

    const goal = await prisma.goal.update({
      where: { id },
      data: {
        ...(body.targetValue !== undefined ? { targetValue: body.targetValue } : {}),
        ...(body.minimumValue !== undefined ? { minimumValue: body.minimumValue } : {}),
        ...(body.stretchValue !== undefined ? { stretchValue: body.stretchValue } : {}),
        ...(body.priority !== undefined ? { priority: body.priority } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
        ...(body.periodStart ? { periodStart: dateKeyToUtc(body.periodStart) } : {}),
        ...(body.periodEnd ? { periodEnd: dateKeyToUtc(body.periodEnd) } : {}),
      },
      include: { kpi: { select: { key: true, displayName: true } } },
    });

    await invalidateCoachCache(user.id);
    return ok({ goal });
  })(request);
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  return withAuth(async ({ user }) => {
    const existing = await prisma.goal.findFirst({ where: { id, userId: user.id }, select: { id: true } });
    if (!existing) return fail(404, { error: "Goal not found." });

    await prisma.goal.delete({ where: { id } });
    await invalidateCoachCache(user.id);
    return ok({ deleted: true });
  })(request);
}
