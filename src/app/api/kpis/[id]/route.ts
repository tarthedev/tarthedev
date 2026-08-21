import { z } from "zod";

import { prisma } from "@/lib/db";
import { fail, ok, parseJson, withAuth } from "@/lib/http/api";

const PatchSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  category: z.string().trim().max(60).nullable().optional(),
  unitType: z.enum(["COUNT", "CURRENCY", "PERCENT", "RATIO"]).optional(),
  aggregation: z.enum(["LATEST", "SUM"]).optional(),
  weight: z.number().positive().max(100).optional(),
  aliases: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  active: z.boolean().optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  return withAuth(async ({ user, request: req }) => {
    const body = await parseJson(req, PatchSchema);
    const existing = await prisma.kpiDefinition.findFirst({ where: { id, userId: user.id }, select: { id: true } });
    if (!existing) return fail(404, { error: "KPI not found." });

    const kpi = await prisma.kpiDefinition.update({ where: { id }, data: body });
    return ok({ kpi });
  })(request);
}

/**
 * DELETE /api/kpis/:id — deactivates rather than deletes by default, because
 * removing a KPI would orphan its history. `?hard=true` deletes for real.
 */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  return withAuth(async ({ user, request: req }) => {
    const existing = await prisma.kpiDefinition.findFirst({ where: { id, userId: user.id }, select: { id: true } });
    if (!existing) return fail(404, { error: "KPI not found." });

    if (new URL(req.url).searchParams.get("hard") === "true") {
      await prisma.kpiDefinition.delete({ where: { id } });
      return ok({ deleted: true });
    }

    await prisma.kpiDefinition.update({ where: { id }, data: { active: false } });
    return ok({ deactivated: true });
  })(request);
}
