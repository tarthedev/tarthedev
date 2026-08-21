import { prisma } from "@/lib/db";
import {
  type DateKey,
  dateKeyInTz,
  dateKeyToUtc,
  todayInTz,
  utcToDateKey,
  zonedDayStartUtc,
} from "@/lib/kpi/dates";
import { computePace, type PaceResult, type UnitType } from "@/lib/kpi/pace";
import { type Period, resolvePeriod, type PeriodType } from "@/lib/kpi/period";
import { buildWorkingCalendar, scheduledHours, type ShiftEntry, type WorkingCalendar } from "@/lib/kpi/schedule";
import { computeOverallScore, type OverallScore } from "@/lib/kpi/scoring";
import { getSettings, type Settings } from "@/lib/settings";

export interface KpiRow {
  kpiId: string;
  key: string;
  displayName: string;
  category: string | null;
  unitType: UnitType;
  weight: number;
  sortOrder: number;
  aggregation: "LATEST" | "SUM";

  goalId: string | null;
  periodType: PeriodType | null;
  minimumValue: number | null;
  targetValue: number;
  stretchValue: number | null;
  priority: number;

  current: number;
  lastObservedAt: Date | null;
  observationCount: number;
  pace: PaceResult;
  /** Cumulative period-to-date value at each capture, oldest first. */
  series: { date: DateKey; value: number; capturedAt: Date }[];
  /** Production attributable to each day, derived from consecutive captures. */
  dailyProduction: { date: DateKey; value: number }[];
}

export interface TodayTarget {
  key: string;
  displayName: string;
  needed: number;
  unitLabel: "day" | "shift";
  status: PaceResult["status"];
  priority: number;
}

export interface DashboardData {
  period: Period;
  today: DateKey;
  /** True when a confirmed snapshot captured today is already reflected. */
  todayCounted: boolean;
  unitLabel: "day" | "shift";
  unitsRemaining: number;
  unitsEngaged: number;
  unitsTotal: number;
  scheduledHoursRemaining: number | null;
  rows: KpiRow[];
  overall: OverallScore;
  todayTargets: TodayTarget[];
  lastSnapshot: { id: string; capturedAt: Date; imageCount: number } | null;
  pendingReviewCount: number;
  settings: Settings;
  timezone: string;
}

export interface DashboardOptions {
  periodType?: PeriodType;
  anchor?: DateKey;
  /** Explicit range; overrides periodType/anchor. */
  range?: { start: DateKey; end: DateKey };
}

/**
 * Builds the single computed view the dashboard, scorecard, coach context and
 * API all read from. Every number here is produced by deterministic code.
 */
export async function buildDashboard(
  userId: string,
  timezone: string,
  options: DashboardOptions = {},
): Promise<DashboardData> {
  const settings = await getSettings(userId);
  const today = todayInTz(timezone);
  const anchor = options.anchor ?? today;

  const period: Period = options.range
    ? { type: "CUSTOM", start: options.range.start, end: options.range.end, label: `${options.range.start} – ${options.range.end}` }
    : resolvePeriod(options.periodType ?? settings.defaultPeriodType, anchor, {
        weekStartsOn: settings.weekStartsOn,
      });

  const periodStartDate = dateKeyToUtc(period.start);
  const periodEndDate = dateKeyToUtc(period.end);

  const [kpis, goals, observations, shiftRows, lastSnapshot, pendingReviewCount] = await Promise.all([
    prisma.kpiDefinition.findMany({
      where: { userId, active: true },
      orderBy: [{ sortOrder: "asc" }, { displayName: "asc" }],
    }),
    prisma.goal.findMany({
      where: {
        userId,
        active: true,
        periodStart: { lte: periodEndDate },
        periodEnd: { gte: periodStartDate },
      },
      orderBy: { priority: "asc" },
    }),
    prisma.metricObservation.findMany({
      where: {
        userId,
        status: "ACCEPTED",
        kpiId: { not: null },
        snapshot: { status: "CONFIRMED" },
        effectiveAt: {
          gte: zonedDayStartUtc(period.start, timezone),
          lt: zonedDayStartUtc(nextDay(period.end), timezone),
        },
      },
      orderBy: { effectiveAt: "asc" },
      select: {
        kpiId: true,
        value: true,
        effectiveAt: true,
        snapshotId: true,
      },
    }),
    prisma.shift.findMany({
      where: { userId, date: { gte: periodStartDate, lte: periodEndDate } },
      orderBy: { date: "asc" },
    }),
    prisma.snapshot.findFirst({
      where: { userId, status: "CONFIRMED" },
      orderBy: { capturedAt: "desc" },
      select: { id: true, capturedAt: true, imageCount: true },
    }),
    prisma.snapshot.count({ where: { userId, status: "NEEDS_REVIEW" } }),
  ]);

  const shifts: ShiftEntry[] = shiftRows.map((s) => ({
    date: utcToDateKey(s.date),
    kind: s.kind,
    hours: s.hours,
  }));
  const calendar: WorkingCalendar = buildWorkingCalendar(shifts, settings.scheduleMode);

  // Today counts as worked once a confirmed snapshot captured today exists —
  // the numbers on screen already include today's production.
  const todayCounted =
    lastSnapshot !== null && dateKeyInTz(lastSnapshot.capturedAt, timezone) === today;

  const goalByKpi = new Map(goals.map((g) => [g.kpiId, g]));
  const observationsByKpi = new Map<string, typeof observations>();
  for (const observation of observations) {
    if (!observation.kpiId) continue;
    const bucket = observationsByKpi.get(observation.kpiId);
    if (bucket) bucket.push(observation);
    else observationsByKpi.set(observation.kpiId, [observation]);
  }

  const rows: KpiRow[] = kpis.map((kpi) => {
    const goal = goalByKpi.get(kpi.id) ?? null;
    const kpiObservations = observationsByKpi.get(kpi.id) ?? [];
    const { current, series, dailyProduction } = aggregate(kpiObservations, kpi.aggregation, timezone);

    const pace = computePace({
      current,
      target: goal?.targetValue ?? 0,
      minimum: goal?.minimumValue ?? null,
      stretch: goal?.stretchValue ?? null,
      periodStart: period.start,
      periodEnd: period.end,
      today,
      calendar,
      todayCounted,
      unitType: kpi.unitType,
    });

    return {
      kpiId: kpi.id,
      key: kpi.key,
      displayName: kpi.displayName,
      category: kpi.category,
      unitType: kpi.unitType,
      weight: kpi.weight,
      sortOrder: kpi.sortOrder,
      aggregation: kpi.aggregation,
      goalId: goal?.id ?? null,
      periodType: (goal?.periodType as PeriodType | undefined) ?? null,
      minimumValue: goal?.minimumValue ?? null,
      targetValue: goal?.targetValue ?? 0,
      stretchValue: goal?.stretchValue ?? null,
      priority: goal?.priority ?? 0,
      current,
      lastObservedAt: kpiObservations.at(-1)?.effectiveAt ?? null,
      observationCount: kpiObservations.length,
      pace,
      series,
      dailyProduction,
    };
  });

  const overall = computeOverallScore(
    rows.map((r) => ({ key: r.key, displayName: r.displayName, weight: r.weight, pace: r.pace })),
    { capAttainmentPct: settings.scoreCapPct },
  );

  const todayTargets: TodayTarget[] = rows
    .filter((r) => r.targetValue > 0 && r.pace.nextUnitTarget !== null && r.pace.nextUnitTarget > 0)
    .map((r) => ({
      key: r.key,
      displayName: r.displayName,
      needed: r.pace.nextUnitTarget as number,
      unitLabel: r.pace.unitLabel,
      status: r.pace.status,
      priority: r.priority,
    }))
    .sort((a, b) => a.priority - b.priority || b.needed - a.needed);

  const reference =
    rows[0]?.pace ??
    computePace({
      current: 0,
      target: 0,
      periodStart: period.start,
      periodEnd: period.end,
      today,
      calendar,
      todayCounted,
    });

  return {
    period,
    today,
    todayCounted,
    unitLabel: calendar.unitLabel,
    unitsRemaining: reference.unitsRemaining,
    unitsEngaged: reference.unitsEngaged,
    unitsTotal: reference.unitsTotal,
    scheduledHoursRemaining: scheduledHours(shifts, todayCounted ? nextDay(today) : today, period.end),
    rows,
    overall,
    todayTargets,
    lastSnapshot,
    pendingReviewCount,
    settings,
    timezone,
  };
}

type ObservationRow = { kpiId: string | null; value: number | null; effectiveAt: Date; snapshotId: string };

/**
 * Collapses a KPI's observations into a current value and two series.
 *
 * LATEST (the default) treats each reading as the period-to-date total printed
 * on the dashboard, so the newest reading wins and daily production is the
 * difference between consecutive readings. SUM treats readings as increments.
 */
function aggregate(
  observations: ObservationRow[],
  mode: "LATEST" | "SUM",
  timezone: string,
): { current: number; series: KpiRow["series"]; dailyProduction: KpiRow["dailyProduction"] } {
  const usable = observations.filter((o): o is ObservationRow & { value: number } => o.value !== null);
  if (usable.length === 0) return { current: 0, series: [], dailyProduction: [] };

  if (mode === "SUM") {
    let running = 0;
    const series = usable.map((o) => {
      running += o.value;
      return { date: dateKeyInTz(o.effectiveAt, timezone), value: running, capturedAt: o.effectiveAt };
    });
    const daily = new Map<DateKey, number>();
    for (const o of usable) {
      const key = dateKeyInTz(o.effectiveAt, timezone);
      daily.set(key, (daily.get(key) ?? 0) + o.value);
    }
    return {
      current: running,
      series,
      dailyProduction: [...daily.entries()].map(([date, value]) => ({ date, value })),
    };
  }

  // LATEST: one cumulative point per capture day, using that day's last reading.
  const byDay = new Map<DateKey, { value: number; capturedAt: Date }>();
  for (const o of usable) {
    const key = dateKeyInTz(o.effectiveAt, timezone);
    const existing = byDay.get(key);
    if (!existing || o.effectiveAt >= existing.capturedAt) {
      byDay.set(key, { value: o.value, capturedAt: o.effectiveAt });
    }
  }

  const series = [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, v]) => ({ date, value: v.value, capturedAt: v.capturedAt }));

  const dailyProduction = series.map((point, index) => {
    const previous = index === 0 ? 0 : (series[index - 1]?.value ?? 0);
    // A dashboard reset mid-period would otherwise show negative production.
    return { date: point.date, value: Math.max(0, point.value - previous) };
  });

  return { current: series.at(-1)?.value ?? 0, series, dailyProduction };
}

function nextDay(key: DateKey): DateKey {
  const d = dateKeyToUtc(key);
  d.setUTCDate(d.getUTCDate() + 1);
  return utcToDateKey(d);
}
