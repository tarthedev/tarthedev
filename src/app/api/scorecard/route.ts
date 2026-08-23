import { ok, searchParams, withAuth } from "@/lib/http/api";
import { buildDashboard } from "@/lib/kpi/dashboard";
import { STATUS_LABEL } from "@/lib/kpi/pace";
import type { PeriodType } from "@/lib/kpi/period";

/** GET /api/scorecard — the flat, scannable performance table. */
export const GET = withAuth(async ({ user, request }) => {
  const period = searchParams(request).get("period");
  const data = await buildDashboard(user.id, user.timezone, {
    ...(period === "DAILY" || period === "WEEKLY" || period === "MONTHLY"
      ? { periodType: period as PeriodType }
      : {}),
  });

  return ok({
    period: data.period,
    unitLabel: data.unitLabel,
    overallScore: data.overall.score,
    formula: data.overall.formula,
    rows: data.rows
      .filter((r) => r.targetValue > 0 || r.observationCount > 0)
      .map((r) => ({
        kpi: r.displayName,
        key: r.key,
        current: r.pace.current,
        goal: r.pace.target,
        attainmentPct: r.pace.attainmentPct,
        remaining: r.pace.remaining,
        requiredRate: r.pace.requiredRate,
        currentRate: r.pace.currentRate,
        projected: r.pace.projected,
        status: r.pace.status,
        statusLabel: STATUS_LABEL[r.pace.status],
      })),
  });
});
