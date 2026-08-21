import Link from "next/link";
import type { Metadata } from "next";

import { TrendChart } from "@/components/charts/trend-chart";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty";
import { ProgressBar } from "@/components/ui/progress";
import { requireUser } from "@/lib/auth/guard";
import { cn } from "@/lib/cn";
import { formatPercent, formatValue } from "@/lib/format";
import { buildDashboard } from "@/lib/kpi/dashboard";
import { previousPeriod, type PeriodType } from "@/lib/kpi/period";

export const metadata: Metadata = { title: "History" };
export const dynamic = "force-dynamic";

const PERIODS: { value: Exclude<PeriodType, "CUSTOM">; label: string; count: number }[] = [
  { value: "DAILY", label: "Daily", count: 21 },
  { value: "WEEKLY", label: "Weekly", count: 12 },
  { value: "MONTHLY", label: "Monthly", count: 12 },
];

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; kpi?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const config = PERIODS.find((p) => p.value === params.period) ?? PERIODS[1]!;

  const current = await buildDashboard(user.id, user.timezone, { periodType: config.value });
  const focusKey = params.kpi && current.rows.some((r) => r.key === params.kpi) ? params.kpi : null;

  // Walk back period by period. Stops as soon as history runs out, so a new
  // install does not render a row of empty charts.
  const periods: {
    label: string;
    overallScore: number;
    rows: { key: string; displayName: string; value: number; target: number; attainmentPct: number }[];
  }[] = [];

  let period = current.period;
  for (let i = 0; i < config.count; i++) {
    const past = await buildDashboard(user.id, user.timezone, {
      range: { start: period.start, end: period.end },
    });
    const rows = past.rows
      .filter((r) => r.observationCount > 0 || r.targetValue > 0)
      .map((r) => ({
        key: r.key,
        displayName: r.displayName,
        value: r.current,
        target: r.targetValue,
        attainmentPct: r.pace.attainmentPct,
      }));

    const hasProduction = rows.some((r) => r.value > 0);
    if (i > 0 && !hasProduction) break;
    periods.unshift({ label: period.label, overallScore: past.overall.score, rows });
    period = previousPeriod(period, { weekStartsOn: current.settings.weekStartsOn });
  }

  const hasHistory = periods.some((p) => p.rows.some((r) => r.value > 0));

  const chartData = focusKey
    ? periods.map((p) => ({
        label: p.label,
        value: p.rows.find((r) => r.key === focusKey)?.value ?? 0,
      }))
    : periods.map((p) => ({ label: p.label, value: Math.round(p.overallScore) }));

  const focusRow = focusKey ? current.rows.find((r) => r.key === focusKey) : null;

  return (
    <div>
      <PageHeader
        title="History"
        description="Everything you have ever confirmed, kept forever. Snapshots are never overwritten, so the record of how a period actually unfolded stays intact."
        actions={
          <div className="inline-flex rounded-lg border border-[var(--border)] p-0.5">
            {PERIODS.map((option) => (
              <Link
                key={option.value}
                href={`/history?period=${option.value}${focusKey ? `&kpi=${focusKey}` : ""}`}
                aria-current={config.value === option.value ? "page" : undefined}
                className={cn(
                  "inline-flex h-8 items-center rounded-md px-3 text-[12px] font-medium",
                  config.value === option.value
                    ? "bg-[var(--surface-raised)] text-[var(--text)]"
                    : "text-[var(--text-subtle)] hover:text-[var(--text)]",
                )}
              >
                {option.label}
              </Link>
            ))}
          </div>
        }
      />
      <PageBody>
        {!hasHistory ? (
          <Card>
            <EmptyState
              title="No history yet"
              description="Once you have confirmed snapshots across a couple of periods, this page shows how each KPI is trending and how often you hit goal."
              action={{ label: "Upload a snapshot", href: "/upload" }}
            />
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle>{focusRow ? focusRow.displayName : "Overall score"}</CardTitle>
                <div className="flex flex-wrap gap-1">
                  <FilterLink href={`/history?period=${config.value}`} active={!focusKey} label="All" />
                  {current.rows
                    .filter((r) => r.targetValue > 0 || r.observationCount > 0)
                    .map((r) => (
                      <FilterLink
                        key={r.key}
                        href={`/history?period=${config.value}&kpi=${r.key}`}
                        active={focusKey === r.key}
                        label={r.displayName}
                      />
                    ))}
                </div>
              </CardHeader>
              <CardBody>
                <TrendChart
                  data={chartData}
                  valueLabel={focusRow ? focusRow.displayName : "Score"}
                  initialKind="bar"
                  kinds={["bar", "line", "area"]}
                  goal={focusRow && focusRow.targetValue > 0 ? focusRow.targetValue : focusKey ? null : 100}
                  height={280}
                />
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Goal attainment by period</CardTitle>
              </CardHeader>
              <CardBody className="overflow-x-auto p-0">
                <table className="w-full min-w-[640px] text-left text-[13px]">
                  <thead>
                    <tr className="border-y border-[var(--border)] bg-[var(--surface-raised)] text-[11px] tracking-wide text-subtle uppercase">
                      <th scope="col" className="px-5 py-2.5 font-medium">Period</th>
                      <th scope="col" className="px-3 py-2.5 text-right font-medium">Score</th>
                      {(focusKey ? [focusKey] : current.rows.filter((r) => r.targetValue > 0).slice(0, 5).map((r) => r.key)).map(
                        (key) => (
                          <th key={key} scope="col" className="px-3 py-2.5 text-right font-medium">
                            {current.rows.find((r) => r.key === key)?.displayName ?? key}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody className="tnum">
                    {periods
                      .slice()
                      .reverse()
                      .map((p) => (
                        <tr key={p.label} className="border-b border-[var(--border)] last:border-0">
                          <th scope="row" className="px-5 py-3 text-left font-medium">
                            {p.label}
                          </th>
                          <td className="px-3 py-3 text-right">
                            <span className="inline-flex items-center gap-2">
                              {formatPercent(p.overallScore)}
                              <span className="hidden w-16 sm:inline-block">
                                <ProgressBar
                                  value={Math.min(100, p.overallScore)}
                                  status={p.overallScore >= 100 ? "COMPLETE" : p.overallScore >= 90 ? "ON_TRACK" : p.overallScore >= 75 ? "AT_RISK" : "BEHIND"}
                                />
                              </span>
                            </span>
                          </td>
                          {(focusKey
                            ? [focusKey]
                            : current.rows.filter((r) => r.targetValue > 0).slice(0, 5).map((r) => r.key)
                          ).map((key) => {
                            const cell = p.rows.find((r) => r.key === key);
                            return (
                              <td key={key} className="px-3 py-3 text-right">
                                {cell && cell.value > 0 ? (
                                  <>
                                    {formatValue(cell.value)}
                                    {cell.target > 0 && <span className="text-subtle"> / {formatValue(cell.target)}</span>}
                                  </>
                                ) : (
                                  <span className="text-subtle">—</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                  </tbody>
                </table>
              </CardBody>
            </Card>
          </>
        )}
      </PageBody>
    </div>
  );
}

function FilterLink({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cn(
        "rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
        active
          ? "bg-[var(--surface-raised)] text-[var(--text)]"
          : "text-[var(--text-subtle)] hover:text-[var(--text)]",
      )}
    >
      {label}
    </Link>
  );
}
