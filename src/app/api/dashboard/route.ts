import { ok, searchParams, withAuth } from "@/lib/http/api";
import { evaluateAlerts } from "@/lib/kpi/alerts";
import { buildDashboard } from "@/lib/kpi/dashboard";
import { isDateKey } from "@/lib/kpi/dates";
import type { PeriodType } from "@/lib/kpi/period";

const PERIOD_TYPES = new Set(["DAILY", "WEEKLY", "MONTHLY"]);

/** GET /api/dashboard — the full computed view for a period. */
export const GET = withAuth(async ({ user, request }) => {
  const params = searchParams(request);
  const periodParam = params.get("period");
  const start = params.get("start");
  const end = params.get("end");

  const data = await buildDashboard(user.id, user.timezone, {
    ...(periodParam && PERIOD_TYPES.has(periodParam) ? { periodType: periodParam as PeriodType } : {}),
    ...(params.get("anchor") && isDateKey(params.get("anchor") as string)
      ? { anchor: params.get("anchor") as string }
      : {}),
    ...(start && end && isDateKey(start) && isDateKey(end) ? { range: { start, end } } : {}),
  });

  return ok({
    period: data.period,
    today: data.today,
    todayCounted: data.todayCounted,
    unitLabel: data.unitLabel,
    unitsEngaged: data.unitsEngaged,
    unitsRemaining: data.unitsRemaining,
    unitsTotal: data.unitsTotal,
    scheduledHoursRemaining: data.scheduledHoursRemaining,
    overall: data.overall,
    todayTargets: data.todayTargets,
    pendingReviewCount: data.pendingReviewCount,
    lastSnapshot: data.lastSnapshot,
    alerts: evaluateAlerts(data),
    kpis: data.rows.map((row) => ({
      key: row.key,
      displayName: row.displayName,
      category: row.category,
      unitType: row.unitType,
      weight: row.weight,
      current: row.current,
      target: row.targetValue,
      minimum: row.minimumValue,
      stretch: row.stretchValue,
      observationCount: row.observationCount,
      lastObservedAt: row.lastObservedAt,
      pace: row.pace,
    })),
  });
});
