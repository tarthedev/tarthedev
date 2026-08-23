import { z } from "zod";

import { invalidateCoachCache } from "@/lib/ai/coach";
import { prisma } from "@/lib/db";
import { fail, ok, parseJson, searchParams, withAuth } from "@/lib/http/api";
import { dateKeyToUtc, isDateKey, todayInTz } from "@/lib/kpi/dates";
import { resolvePeriod, type PeriodType } from "@/lib/kpi/period";
import { getSettings } from "@/lib/settings";

export const GET = withAuth(async ({ user, request }) => {
  const params = searchParams(request);
  const activeOnly = params.get("active") !== "false";

  const goals = await prisma.goal.findMany({
    where: { userId: user.id, ...(activeOnly ? { active: true } : {}) },
    orderBy: [{ periodStart: "desc" }, { priority: "asc" }],
    include: { kpi: { select: { id: true, key: true, displayName: true, unitType: true } } },
  });
  return ok({ goals });
});

const DateKey = z.string().refine(isDateKey, "Use a YYYY-MM-DD date.");

const CreateSchema = z
  .object({
    kpiId: z.string().min(1),
    periodType: z.enum(["DAILY", "WEEKLY", "MONTHLY", "CUSTOM"]),
    /** Omitted for non-custom periods: the current period is resolved instead. */
    periodStart: DateKey.optional(),
    periodEnd: DateKey.optional(),
    targetValue: z.number().finite().nonnegative(),
    minimumValue: z.number().finite().nonnegative().nullable().optional(),
    stretchValue: z.number().finite().nonnegative().nullable().optional(),
    priority: z.number().int().min(0).max(999).default(0),
    scope: z.enum(["PERSONAL", "STORE"]).default("PERSONAL"),
    notes: z.string().trim().max(1000).nullable().optional(),
  })
  .refine((v) => v.periodType !== "CUSTOM" || (v.periodStart && v.periodEnd), {
    message: "Custom goals need a start and end date.",
    path: ["periodStart"],
  })
  .refine((v) => v.minimumValue == null || v.minimumValue <= v.targetValue, {
    message: "Minimum cannot be above the target.",
    path: ["minimumValue"],
  })
  .refine((v) => v.stretchValue == null || v.stretchValue >= v.targetValue, {
    message: "Stretch cannot be below the target.",
    path: ["stretchValue"],
  });

/** POST /api/goals — upserts the goal for a KPI in a period. */
export const POST = withAuth(async ({ user, request }) => {
  const body = await parseJson(request, CreateSchema);

  const kpi = await prisma.kpiDefinition.findFirst({
    where: { id: body.kpiId, userId: user.id },
    select: { id: true },
  });
  if (!kpi) return fail(404, { error: "That KPI does not exist." });

  const settings = await getSettings(user.id);
  const anchor = body.periodStart ?? todayInTz(user.timezone);
  const period =
    body.periodType === "CUSTOM"
      ? { start: body.periodStart as string, end: body.periodEnd as string }
      : resolvePeriod(body.periodType as PeriodType, anchor, { weekStartsOn: settings.weekStartsOn });

  if (period.end < period.start) {
    return fail(400, { error: "The end date is before the start date.", fields: { periodEnd: "Must be after the start." } });
  }

  const goal = await prisma.goal.upsert({
    where: {
      userId_kpiId_periodType_periodStart_scope: {
        userId: user.id,
        kpiId: body.kpiId,
        periodType: body.periodType,
        periodStart: dateKeyToUtc(period.start),
        scope: body.scope,
      },
    },
    create: {
      userId: user.id,
      kpiId: body.kpiId,
      periodType: body.periodType,
      periodStart: dateKeyToUtc(period.start),
      periodEnd: dateKeyToUtc(period.end),
      targetValue: body.targetValue,
      minimumValue: body.minimumValue ?? null,
      stretchValue: body.stretchValue ?? null,
      priority: body.priority,
      scope: body.scope,
      notes: body.notes ?? null,
    },
    update: {
      periodEnd: dateKeyToUtc(period.end),
      targetValue: body.targetValue,
      minimumValue: body.minimumValue ?? null,
      stretchValue: body.stretchValue ?? null,
      priority: body.priority,
      notes: body.notes ?? null,
      active: true,
    },
    include: { kpi: { select: { key: true, displayName: true } } },
  });

  // Goals feed every pace calculation, so cached coaching is now stale.
  await invalidateCoachCache(user.id);
  return ok({ goal }, { status: 201 });
});
