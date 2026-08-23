import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { TrendChart } from "@/components/charts/trend-chart";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty";
import { ProgressBar, TieredProgress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/ui/status";
import { requireUser } from "@/lib/auth/guard";
import { formatPercent, formatRate, formatValue } from "@/lib/format";
import { buildDashboard } from "@/lib/kpi/dashboard";
import { formatDateKey } from "@/lib/kpi/dates";
import { previousPeriod } from "@/lib/kpi/period";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ key: string }>;
}): Promise<Metadata> {
  const { key } = await params;
  return { title: key.replace(/_/g, " ") };
}

export default async function KpiDetailPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const user = await requireUser();
  const data = await buildDashboard(user.id, user.timezone);
  const row = data.rows.find((r) => r.key === key);
  if (!row) notFound();

  const { pace } = row;

  // Prior periods give the "how you're trending" answer without a model call.
  const priorPeriods = [];
  let period = data.period;
  for (let i = 0; i < 6; i++) {
    period = previousPeriod(period, { weekStartsOn: data.settings.weekStartsOn });
    const past = await buildDashboard(user.id, user.timezone, {
      range: { start: period.start, end: period.end },
    });
    const pastRow = past.rows.find((r) => r.key === key);
    if (!pastRow || pastRow.observationCount === 0) break;
    priorPeriods.unshift({
      label: period.label,
      value: pastRow.current,
      target: pastRow.targetValue,
      attainmentPct: pastRow.pace.attainmentPct,
    });
  }

  const dailyPoints = row.dailyProduction.map((d) => ({
    label: formatDateKey(d.date, "MMM d"),
    value: d.value,
  }));

  const cumulativePoints = row.series.map((point, index) => ({
    label: formatDateKey(point.date, "MMM d"),
    value: point.value,
    // Even-pace reference so the shape of the gap is visible, not just the number.
    pace:
      pace.unitsTotal > 0 && row.targetValue > 0
        ? Math.round(((index + 1) / Math.max(row.series.length, 1)) * pace.expectedByNow * 100) / 100
        : undefined,
  }));

  const best = row.dailyProduction.reduce<{ date: string; value: number } | null>(
    (top, d) => (top === null || d.value > top.value ? d : top),
    null,
  );
  const worst = row.dailyProduction.reduce<{ date: string; value: number } | null>(
    (low, d) => (low === null || d.value < low.value ? d : low),
    null,
  );
  const average =
    row.dailyProduction.length > 0
      ? row.dailyProduction.reduce((sum, d) => sum + d.value, 0) / row.dailyProduction.length
      : 0;

  return (
    <div>
      <PageHeader
        title={row.displayName}
        description={`${data.period.label} · ${row.category ?? "Uncategorised"}`}
        actions={<StatusBadge status={pace.status} />}
      />
      <PageBody>
        <Card>
          <CardBody className="pt-5">
            <div className="flex flex-wrap items-end justify-between gap-6">
              <div>
                <div className="flex items-baseline gap-2 tnum">
                  <span className="text-4xl leading-none font-semibold tracking-tight">
                    {formatValue(pace.current, row.unitType)}
                  </span>
                  {row.targetValue > 0 && (
                    <span className="text-lg text-subtle">/ {formatValue(pace.target, row.unitType)}</span>
                  )}
                </div>
                <p className="mt-2 text-sm text-muted tnum">
                  {row.targetValue > 0
                    ? `${formatPercent(pace.attainmentPct)} of goal · ${formatValue(pace.remaining, row.unitType)} remaining`
                    : "No goal set for this period"}
                </p>
              </div>

              {row.targetValue > 0 && (
                <div className="w-full sm:w-80">
                  <TieredProgress
                    current={pace.current}
                    minimum={row.minimumValue}
                    target={row.targetValue}
                    stretch={row.stretchValue}
                    status={pace.status}
                  />
                  <div className="mt-2 flex justify-between text-[11px] text-subtle tnum">
                    <span>{row.minimumValue !== null ? `Min ${row.minimumValue}` : ""}</span>
                    <span>Target {row.targetValue}</span>
                    <span>{row.stretchValue !== null ? `Stretch ${row.stretchValue}` : ""}</span>
                  </div>
                </div>
              )}
            </div>

            {row.targetValue > 0 && (
              <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-[var(--border)] pt-5 sm:grid-cols-4">
                <Metric label={`Required / ${pace.unitLabel}`} value={formatRate(pace.requiredRate, pace.unitLabel, row.unitType)} />
                <Metric label={`Current / ${pace.unitLabel}`} value={formatRate(pace.currentRate, pace.unitLabel, row.unitType)} />
                <Metric
                  label="Projected finish"
                  value={`${formatValue(pace.projected, row.unitType)} (${formatPercent(pace.projectedAttainmentPct)})`}
                />
                <Metric
                  label={`${pace.unitLabel}s remaining`}
                  value={String(pace.unitsRemaining)}
                />
              </dl>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>How you&apos;re trending</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="mb-4 text-[13px] leading-relaxed text-muted tnum">
              {pace.unitsEngaged === 0
                ? "This period has not started producing yet."
                : pace.gapToPace >= 0
                  ? `You are ${formatValue(Math.abs(pace.gapToPace), row.unitType)} ahead of an even pace. At ${formatRate(pace.currentRate, pace.unitLabel, row.unitType)} you finish at ${formatValue(pace.projected, row.unitType)}.`
                  : `You are ${formatValue(Math.abs(pace.gapToPace), row.unitType)} behind an even pace. At ${formatRate(pace.currentRate, pace.unitLabel, row.unitType)} you finish at ${formatValue(pace.projected, row.unitType)} against a goal of ${formatValue(pace.target, row.unitType)}.`}
            </p>
            <TrendChart
              data={cumulativePoints}
              goal={row.targetValue > 0 ? row.targetValue : null}
              valueLabel={row.displayName}
              initialKind="area"
              kinds={["area", "line", "bar"]}
            />
          </CardBody>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Production per day</CardTitle>
            </CardHeader>
            <CardBody>
              {dailyPoints.length === 0 ? (
                <EmptyState
                  title="No captures this period"
                  description="Daily production is derived from the difference between consecutive snapshots, so it appears once you have uploaded twice."
                  action={{ label: "Upload", href: "/upload" }}
                />
              ) : (
                <>
                  <TrendChart data={dailyPoints} kinds={["bar", "line"]} initialKind="bar" valueLabel="Produced" height={220} />
                  <dl className="mt-4 grid grid-cols-3 gap-4 border-t border-[var(--border)] pt-4">
                    <Metric label="Average" value={formatValue(Math.round(average * 100) / 100, row.unitType)} />
                    <Metric
                      label="Best day"
                      value={best ? `${formatValue(best.value, row.unitType)} · ${formatDateKey(best.date, "MMM d")}` : "—"}
                    />
                    <Metric
                      label="Slowest day"
                      value={worst ? `${formatValue(worst.value, row.unitType)} · ${formatDateKey(worst.date, "MMM d")}` : "—"}
                    />
                  </dl>
                </>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Prior periods</CardTitle>
            </CardHeader>
            <CardBody>
              {priorPeriods.length === 0 ? (
                <p className="text-sm text-muted">
                  No history for {row.displayName} yet. After a couple of periods this shows whether the trend is
                  improving.
                </p>
              ) : (
                <>
                  <TrendChart
                    data={priorPeriods.map((p) => ({ label: p.label, value: p.value }))}
                    kinds={["bar", "line"]}
                    initialKind="bar"
                    valueLabel={row.displayName}
                    height={220}
                  />
                  <ul className="mt-4 space-y-2 border-t border-[var(--border)] pt-4 text-[12px] tnum">
                    {priorPeriods
                      .slice()
                      .reverse()
                      .map((p) => (
                        <li key={p.label} className="flex items-center justify-between gap-3">
                          <span className="truncate text-muted">{p.label}</span>
                          <span className="flex items-center gap-3">
                            <span>
                              {formatValue(p.value, row.unitType)}
                              {p.target > 0 && <span className="text-subtle"> / {formatValue(p.target, row.unitType)}</span>}
                            </span>
                            {p.target > 0 && (
                              <span className="w-20">
                                <ProgressBar
                                  value={p.attainmentPct}
                                  status={p.attainmentPct >= 100 ? "COMPLETE" : p.attainmentPct >= 90 ? "ON_TRACK" : p.attainmentPct >= 75 ? "AT_RISK" : "BEHIND"}
                                />
                              </span>
                            )}
                          </span>
                        </li>
                      ))}
                  </ul>
                </>
              )}
            </CardBody>
          </Card>
        </div>

        <p className="text-[12px] text-subtle">
          <Link href="/goals" className="underline underline-offset-2">
            Adjust the goal
          </Link>{" "}
          or{" "}
          <Link href="/snapshots" className="underline underline-offset-2">
            review the snapshots
          </Link>{" "}
          these numbers came from.
        </p>
      </PageBody>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] tracking-wide text-subtle uppercase">{label}</dt>
      <dd className="mt-1 truncate text-sm font-medium tnum">{value}</dd>
    </div>
  );
}
