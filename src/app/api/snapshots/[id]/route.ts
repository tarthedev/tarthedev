import { z } from "zod";

import { prisma } from "@/lib/db";
import { fail, ok, parseJson, withAuth } from "@/lib/http/api";
import { logger } from "@/lib/logger";
import { getStorage } from "@/lib/storage";
import { invalidateCoachCache } from "@/lib/ai/coach";

interface Params {
  params: Promise<{ id: string }>;
}

/** GET /api/snapshots/:id — full audit view: images, readings, attempts. */
export async function GET(request: Request, context: Params): Promise<Response> {
  const { id } = await context.params;
  return withAuth(async ({ user }) => {
    const snapshot = await prisma.snapshot.findFirst({
      where: { id, userId: user.id },
      include: {
        images: { orderBy: { orderIndex: "asc" } },
        observations: {
          orderBy: [{ status: "asc" }, { rawLabel: "asc" }],
          include: { kpi: { select: { id: true, key: true, displayName: true, unitType: true } } },
        },
        attempts: { orderBy: { attemptNumber: "asc" } },
      },
    });
    if (!snapshot) return fail(404, { error: "Snapshot not found." });
    return ok({ snapshot });
  })(request);
}

const PatchSchema = z.object({
  notes: z.string().max(2000).nullable().optional(),
  reportingPeriodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  reportingPeriodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

export async function PATCH(request: Request, context: Params): Promise<Response> {
  const { id } = await context.params;
  return withAuth(async ({ user, request: req }) => {
    const body = await parseJson(req, PatchSchema);
    const existing = await prisma.snapshot.findFirst({ where: { id, userId: user.id }, select: { id: true } });
    if (!existing) return fail(404, { error: "Snapshot not found." });

    const snapshot = await prisma.snapshot.update({
      where: { id },
      data: {
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        ...(body.reportingPeriodStart !== undefined
          ? {
              reportingPeriodStart: body.reportingPeriodStart
                ? new Date(`${body.reportingPeriodStart}T00:00:00.000Z`)
                : null,
            }
          : {}),
        ...(body.reportingPeriodEnd !== undefined
          ? {
              reportingPeriodEnd: body.reportingPeriodEnd
                ? new Date(`${body.reportingPeriodEnd}T00:00:00.000Z`)
                : null,
            }
          : {}),
      },
    });

    await invalidateCoachCache(user.id);
    return ok({ snapshot });
  })(request);
}

/**
 * DELETE /api/snapshots/:id — removes the snapshot, its readings, and the
 * stored screenshots. Deleting a snapshot deletes its images: that is the
 * retention promise made on the upload screen.
 */
export async function DELETE(request: Request, context: Params): Promise<Response> {
  const { id } = await context.params;
  return withAuth(async ({ user }) => {
    const snapshot = await prisma.snapshot.findFirst({
      where: { id, userId: user.id },
      select: { id: true, images: { select: { storageKey: true } } },
    });
    if (!snapshot) return fail(404, { error: "Snapshot not found." });

    const storage = getStorage();
    for (const image of snapshot.images) {
      await storage.delete(image.storageKey).catch(() => undefined);
    }
    // Sweeps the snapshot's directory so no stray bytes survive the delete.
    await storage.deletePrefix(`${user.id}/${snapshot.id}`).catch(() => undefined);

    await prisma.snapshot.delete({ where: { id } });
    await invalidateCoachCache(user.id);
    await logger.info({
      userId: user.id,
      category: "snapshot",
      message: "Snapshot and its screenshots deleted.",
      meta: { snapshotId: id, images: snapshot.images.length },
    });

    return ok({ deleted: true });
  })(request);
}
