import { z } from "zod";

import { invalidateCoachCache } from "@/lib/ai/coach";
import { prisma } from "@/lib/db";
import { ok, parseJson, searchParams, withAuth } from "@/lib/http/api";
import { dateKeyToUtc, isDateKey, utcToDateKey } from "@/lib/kpi/dates";

export const GET = withAuth(async ({ user, request }) => {
  const params = searchParams(request);
  const start = params.get("start");
  const end = params.get("end");

  const shifts = await prisma.shift.findMany({
    where: {
      userId: user.id,
      ...(start && isDateKey(start) ? { date: { gte: dateKeyToUtc(start) } } : {}),
      ...(end && isDateKey(end) ? { date: { lte: dateKeyToUtc(end) } } : {}),
    },
    orderBy: { date: "asc" },
  });

  return ok({
    shifts: shifts.map((s) => ({
      id: s.id,
      date: utcToDateKey(s.date),
      kind: s.kind,
      hours: s.hours,
      notes: s.notes,
    })),
  });
});

const EntrySchema = z.object({
  date: z.string().refine(isDateKey, "Use a YYYY-MM-DD date."),
  kind: z.enum(["WORK", "OFF", "PTO", "HOLIDAY"]),
  hours: z.number().min(0).max(24).nullable().optional(),
  notes: z.string().trim().max(200).nullable().optional(),
});

const BodySchema = z.object({ shifts: z.array(EntrySchema).min(1).max(400) });

/**
 * POST /api/shifts — bulk upsert of the schedule.
 *
 * Shift-based pacing is far more useful than calendar pacing: "1.25 per
 * remaining shift" is an instruction, "1.0 per day" is trivia when two of those
 * days are days off.
 */
export const POST = withAuth(async ({ user, request }) => {
  const body = await parseJson(request, BodySchema);

  await prisma.$transaction(
    body.shifts.map((shift) =>
      prisma.shift.upsert({
        where: { userId_date: { userId: user.id, date: dateKeyToUtc(shift.date) } },
        create: {
          userId: user.id,
          date: dateKeyToUtc(shift.date),
          kind: shift.kind,
          hours: shift.hours ?? null,
          notes: shift.notes ?? null,
        },
        update: { kind: shift.kind, hours: shift.hours ?? null, notes: shift.notes ?? null },
      }),
    ),
  );

  await invalidateCoachCache(user.id);
  return ok({ saved: body.shifts.length });
});

export const DELETE = withAuth(async ({ user, request }) => {
  const date = searchParams(request).get("date");
  if (!date || !isDateKey(date)) {
    return ok({ deleted: 0 });
  }
  const result = await prisma.shift.deleteMany({ where: { userId: user.id, date: dateKeyToUtc(date) } });
  await invalidateCoachCache(user.id);
  return ok({ deleted: result.count });
});
