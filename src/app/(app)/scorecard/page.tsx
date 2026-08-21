import Link from "next/link";
import type { Metadata } from "next";

import { AttainmentChart } from "@/components/charts/attainment-chart";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty";
import { StatusBadge } from "@/components/ui/status";
import { requireUser } from "@/lib/auth/guard";
import { formatPercent, formatRate, formatValue } from "@/lib/format";
import { buildDashboard } from "@/lib/kpi/dashboard";
import type { PeriodType } from "@/lib/kpi/period";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Scorecard" };
export const dynamic = "force-dynamic";

const PERIODS: { value: PeriodType; label: string }[] = [
  { value: "DAILY", label: "Day" },
  { value: "WEEKLY", label: "Week" },
  { value: "MONTHLY", label: "Month" },
];

export default async function ScorecardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const periodType = (PERIODS.find((p) => p.value === params.period)?.value ?? undefined) as
    | PeriodType
    | undefined;

  const data = await buildDashboard(user.id, user.timezone, periodType ? { periodType } : {});
  const rows = data.rows.filter((r) => r.targetValue > 0 || r.observationCount > 0);

  return (
    <div>
      <PageHeader
        title="Scorecard"
        description={`${data.period.label} · ${data.unitsRemaining} ${data.unitLabel}${data.unitsRemaining === 1 ? "" : "s"} remaining`}
        actions={
          <div className="inline-flex rounded-lg border border-[var(--border)] p-0.5">
            {PERIODS.map((option) => {
              const active = (params.period ?? data.settings.defaultPeriodType) === option.value;
              return (
                <Link
                  key={option.value}
                  href={`/scorecard?period=${option.value}`}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-flex h-8 items-center rounded-md px-3 text-[12px] font-medium",
                    active
                      ? "bg-[var(--surface-raised)] text-[var(--text)]"
                      : "text-[var(--text-subtle)] hover:text-[var(--text)]",
                  )}
                >
                  {option.label}
                </Link>
              );
            })}
          </div>
        }
      />
      <PageBody>
        {rows.length === 0 ? (
          <Card>
            <EmptyState
              title="Nothing to score yet"
              description="Set goals for your KPIs and upload a snapshot, and this page becomes the one-screen answer to how the period is going."
              action={{ label: "Set goals", href: "/goals" }}
            />
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Performance</CardTitle>
                <span className="text-2xl leading-none font-semibold tracking-tight tnum">
                  {formatPercent(data.overall.score)}
                </span>
              </CardHeader>
              <CardBody className="overflow-x-auto p-0">
                <table className="w-full min-w-[720px] text-left text-[13px]">
                  <caption className="sr-only-focusable">
                    KPI performance for {data.period.label}
                  </caption>
                  <thead>
                    <tr className="border-y border-[var(--border)] bg-[var(--surface-raised)] text-[11px] tracking-wide text-subtle uppercase">
                      <th scope="col" className="px-5 py-2.5 font-medium">KPI</th>
                      <th scope="col" className="px-3 py-2.5 text-right font-medium">Current</th>
                      <th scope="col" className="px-3 py-2.5 text-right font-medium">Goal</th>
                      <th scope="col" className="px-3 py-2.5 text-right font-medium">%</th>
                      <th scope="col" className="px-3 py-2.5 text-right font-medium">Remaining</th>
                      <th scope="col" className="px-3 py-2.5 text-right font-medium">Required</th>
                      <th scope="col" className="px-3 py-2.5 text-right font-medium">Projected</th>
                      <th scope="col" className="px-5 py-2.5 text-right font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="tnum">
                    {rows.map((row) => (
                      <tr key={row.key} className="border-b border-[var(--border)] last:border-0">
                        <th scope="row" className="px-5 py-3 text-left font-medium">
                          <Link href={`/kpi/${row.key}`} className="hover:underline">
                            {row.displayName}
                          </Link>
                        </th>
                        <td className="px-3 py-3 text-right font-medium">
                          {formatValue(row.pace.current, row.unitType)}
                        </td>
                        <td className="px-3 py-3 text-right text-muted">
                          {row.targetValue > 0 ? formatValue(row.pace.target, row.unitType) : "—"}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {row.targetValue > 0 ? formatPercent(row.pace.attainmentPct) : "—"}
                        </td>
                        <td className="px-3 py-3 text-right text-muted">
                          {row.targetValue > 0 ? formatValue(row.pace.remaining, row.unitType) : "—"}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {formatRate(row.pace.requiredRate, row.pace.unitLabel, row.unitType)}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {row.targetValue > 0 ? formatValue(row.pace.projected, row.unitType) : "—"}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <StatusBadge status={row.pace.status} size="sm" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardBody>
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Attainment by KPI</CardTitle>
                </CardHeader>
                <CardBody>
                  <AttainmentChart
                    rows={rows
                      .filter((r) => r.targetValue > 0)
                      .map((r) => ({
                        name: r.displayName,
                        attainment: r.pace.attainmentPct,
                        status: r.pace.status,
                      }))}
                  />
                </CardBody>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>How the score is calculated</CardTitle>
                </CardHeader>
                <CardBody>
                  <p className="text-[13px] leading-relaxed text-muted">
                    Raw KPI values are never averaged — different KPIs have different goals, so only attainment is
                    comparable. Each KPI&apos;s attainment is capped at {data.overall.cap}% and weighted by the
                    importance you set in Settings.
                  </p>
                  <p className="mt-3 rounded-lg bg-[var(--surface-raised)] p-3 font-mono text-[12px] leading-relaxed break-words">
                    {data.overall.formula}
                  </p>
                  <ul className="mt-4 space-y-1.5 text-[12px] tnum">
                    {data.overall.components.map((component) => (
                      <li key={component.key} className="flex justify-between gap-4">
                        <span className="truncate text-muted">
                          {component.displayName}
                          {component.capped && <span className="ml-1 text-[var(--warning)]">(capped)</span>}
                        </span>
                        <span>
                          {formatPercent(component.effectiveAttainmentPct)} ×{" "}
                          {Math.round(component.normalizedWeight * 100)}%
                        </span>
                      </li>
                    ))}
                  </ul>
                </CardBody>
              </Card>
            </div>
          </>
        )}
      </PageBody>
    </div>
  );
}
