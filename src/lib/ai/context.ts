import type { DashboardData, KpiRow } from "@/lib/kpi/dashboard";
import { STATUS_LABEL } from "@/lib/kpi/pace";
import { formatDateKey } from "@/lib/kpi/dates";

/**
 * Turns the computed dashboard into the smallest text block that can answer a
 * coaching question.
 *
 * This is the main lever on AI cost. The model never receives the database, the
 * raw observation history, or anything it would have to do arithmetic on — only
 * numbers the pace engine already produced. A full weekly context lands around
 * 400–700 tokens regardless of how much history is stored.
 */

export interface ContextOptions {
  /** Attainment for previous periods, for trend questions. */
  history?: HistoryPoint[];
  /** Include per-KPI daily production. Off by default — it is token-expensive. */
  includeDailyProduction?: boolean;
  /** Cap on how many KPIs to describe; the least important are dropped. */
  maxKpis?: number;
}

export interface HistoryPoint {
  periodLabel: string;
  overallScore: number;
  kpis: { key: string; displayName: string; value: number; target: number; attainmentPct: number }[];
}

const num = (value: number): string =>
  Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");

function kpiBlock(row: KpiRow, unitLabel: string): string {
  const p = row.pace;
  const lines = [
    `${row.displayName.toUpperCase()} (${row.key})`,
    `  current ${num(p.current)}`,
  ];

  if (row.targetValue > 0) {
    lines.push(`  goal ${num(p.target)}`);
    lines.push(`  attainment ${p.attainmentPct.toFixed(1)}%`);
    lines.push(`  remaining ${num(p.remaining)}`);
    lines.push(
      p.requiredRate === null
        ? `  required/${unitLabel} n/a (no ${unitLabel}s left)`
        : `  required/${unitLabel} ${num(p.requiredRate)}`,
    );
    lines.push(`  current pace/${unitLabel} ${num(p.currentRate)}`);
    lines.push(`  projected finish ${num(p.projected)} (${p.projectedAttainmentPct.toFixed(0)}% of goal)`);
    lines.push(`  status ${STATUS_LABEL[p.status]}`);
    if (row.minimumValue !== null) lines.push(`  minimum goal ${num(row.minimumValue)}`);
    if (row.stretchValue !== null) lines.push(`  stretch goal ${num(row.stretchValue)}`);
  } else {
    lines.push("  goal not set");
  }

  if (row.observationCount === 0) lines.push("  no confirmed readings this period");
  return lines.join("\n");
}

export function buildPerformanceContext(data: DashboardData, options: ContextOptions = {}): string {
  const unit = data.unitLabel;
  const sections: string[] = [];

  sections.push(
    [
      "PERFORMANCE DATA",
      "All numbers below are computed by the application. Use them exactly as given.",
      "",
      `TODAY: ${formatDateKey(data.today)} (${data.timezone})`,
      `CURRENT PERIOD: ${data.period.label}`,
      `${unit.toUpperCase()}S ELAPSED: ${data.unitsEngaged} of ${data.unitsTotal}`,
      `${unit.toUpperCase()}S REMAINING: ${data.unitsRemaining}`,
      data.scheduledHoursRemaining !== null
        ? `SCHEDULED HOURS REMAINING: ${num(data.scheduledHoursRemaining)}`
        : null,
      `TODAY ALREADY COUNTED: ${data.todayCounted ? "yes — today's production is included above" : "no — today is still sellable"}`,
    ]
      .filter(Boolean)
      .join("\n"),
  );

  if (data.overall.components.length > 0) {
    sections.push(
      `OVERALL WEIGHTED SCORE: ${data.overall.score.toFixed(1)}%\n  formula: ${data.overall.formula}`,
    );
  }

  const ranked = [...data.rows]
    .filter((r) => r.targetValue > 0 || r.observationCount > 0)
    .sort((a, b) => b.weight - a.weight || a.sortOrder - b.sortOrder);
  const limited = options.maxKpis ? ranked.slice(0, options.maxKpis) : ranked;

  sections.push(
    limited.length > 0
      ? `KPIs\n\n${limited.map((r) => kpiBlock(r, unit)).join("\n\n")}`
      : "KPIs\n\n  No KPI data has been confirmed for this period yet.",
  );

  if (data.todayTargets.length > 0) {
    sections.push(
      `TO STAY ON PACE THIS ${unit.toUpperCase()}\n${data.todayTargets
        .map((t) => `  ${t.displayName}: ${num(t.needed)}`)
        .join("\n")}`,
    );
  }

  if (options.includeDailyProduction) {
    const daily = limited
      .filter((r) => r.dailyProduction.length > 0)
      .map(
        (r) =>
          `  ${r.displayName}: ${r.dailyProduction.map((d) => `${d.date.slice(5)}=${num(d.value)}`).join(" ")}`,
      );
    if (daily.length > 0) sections.push(`DAILY PRODUCTION THIS PERIOD\n${daily.join("\n")}`);
  }

  if (options.history && options.history.length > 0) {
    const rows = options.history.map((h) => {
      const kpis = h.kpis.map((k) => `${k.displayName} ${num(k.value)}/${num(k.target)} (${k.attainmentPct.toFixed(0)}%)`);
      return `  ${h.periodLabel} — overall ${h.overallScore.toFixed(0)}%: ${kpis.join(", ")}`;
    });
    sections.push(`PRIOR PERIODS (most recent first)\n${rows.join("\n")}`);
  }

  return sections.join("\n\n");
}

/**
 * Stable hash of the numbers a brief was written from. When it is unchanged the
 * cached brief is still valid, so no model call is made.
 */
export function fingerprintContext(data: DashboardData): string {
  const material = JSON.stringify({
    period: `${data.period.start}:${data.period.end}`,
    today: data.today,
    todayCounted: data.todayCounted,
    unitsRemaining: data.unitsRemaining,
    rows: data.rows.map((r) => [r.key, r.current, r.targetValue, r.pace.status]),
  });

  // FNV-1a — short, deterministic, and sufficient for cache invalidation.
  let hash = 2166136261;
  for (let i = 0; i < material.length; i++) {
    hash ^= material.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
