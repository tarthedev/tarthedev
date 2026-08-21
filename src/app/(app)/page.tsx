import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Brain, Upload } from "lucide-react";

import { AlertList } from "@/components/dashboard/alerts";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { PeriodHeader } from "@/components/dashboard/period-header";
import { Simulator, type SimulatorPayload } from "@/components/dashboard/simulator";
import { TodaysTargetCard } from "@/components/dashboard/today-target";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty";
import { requireUser } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { formatRelative } from "@/lib/format";
import { evaluateAlerts } from "@/lib/kpi/alerts";
import { buildDashboard } from "@/lib/kpi/dashboard";
import { buildWorkingCalendar } from "@/lib/kpi/schedule";
import { utcToDateKey } from "@/lib/kpi/dates";
import type { CoachBrief } from "@/lib/ai/schemas";

export const metadata: Metadata = { title: "Command Center" };
// Always reflects the latest confirmed snapshot rather than a cached render.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireUser();
  const data = await buildDashboard(user.id, user.timezone);
  const alerts = evaluateAlerts(data);

  const [shifts, cachedBrief] = await Promise.all([
    prisma.shift.findMany({
      where: { userId: user.id },
      select: { date: true, kind: true, hours: true },
    }),
    // The dashboard only ever *reads* a cached brief. It never triggers a model
    // call, so opening this page is always free.
    prisma.coachBrief.findFirst({
      where: { userId: user.id, kind: "DAILY_BRIEF", cacheKey: `${data.period.start}:${data.period.end}` },
      select: { content: true, generatedAt: true },
    }),
  ]);

  const calendar = buildWorkingCalendar(
    shifts.map((s) => ({ date: utcToDateKey(s.date), kind: s.kind, hours: s.hours })),
    data.settings.scheduleMode,
  );

  const simulatorPayload: SimulatorPayload = {
    periodStart: data.period.start,
    periodEnd: data.period.end,
    today: data.today,
    todayCounted: data.todayCounted,
    unitLabel: data.unitLabel,
    workingDates: calendar.datesBetween(data.period.start, data.period.end),
    kpis: data.rows.map((row) => ({
      key: row.key,
      displayName: row.displayName,
      unitType: row.unitType,
      current: row.current,
      target: row.targetValue,
      minimum: row.minimumValue,
      stretch: row.stretchValue,
    })),
  };

  const hasAnyData = data.rows.some((r) => r.observationCount > 0);
  const brief = cachedBrief?.content as CoachBrief | undefined;

  return (
    <div>
      <PeriodHeader data={data} name={user.name} />

      <div className="space-y-5 px-4 py-6 sm:px-6 lg:px-8">
        {alerts.length > 0 && <AlertList alerts={alerts} />}

        {!hasAnyData ? (
          <Card>
            <EmptyState
              icon={<Upload className="size-8" />}
              title="Upload your first KPI screenshots"
              description="Open your Victra KPI dashboard, screenshot every screen that shows your numbers, and upload them all at once. The AI reads them into structured data, and everything else on this page calculates itself."
              action={{ label: "Upload screenshots", href: "/upload" }}
            />
          </Card>
        ) : (
          <>
            <TodaysTargetCard
              targets={data.todayTargets}
              unitLabel={data.unitLabel}
              todayCounted={data.todayCounted}
            />

            <section aria-labelledby="kpis-heading">
              <h2 id="kpis-heading" className="sr-only-focusable">
                KPIs
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {data.rows
                  .filter((row) => row.targetValue > 0 || row.observationCount > 0)
                  .map((row) => (
                    <KpiCard key={row.key} row={row} />
                  ))}
              </div>
            </section>

            <div className="grid gap-5 lg:grid-cols-2">
              <Simulator payload={simulatorPayload} />

              <Card>
                <CardHeader>
                  <CardTitle>AI Coach</CardTitle>
                  {cachedBrief && (
                    <span className="text-[11px] text-subtle">{formatRelative(cachedBrief.generatedAt)}</span>
                  )}
                </CardHeader>
                <CardBody>
                  {brief ? (
                    <>
                      <p className="text-sm leading-relaxed">{brief.headline}</p>
                      <div className="mt-4 rounded-lg bg-[var(--surface-raised)] p-3">
                        <p className="text-[11px] font-medium tracking-wide text-subtle uppercase">
                          One thing to fix today
                        </p>
                        <p className="mt-1 text-sm leading-relaxed">{brief.one_thing}</p>
                      </div>
                      <Link
                        href="/coach"
                        className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
                      >
                        Full brief
                        <ArrowRight className="size-3.5" aria-hidden="true" />
                      </Link>
                    </>
                  ) : (
                    <div className="flex flex-col items-start">
                      <Brain className="size-6 text-[var(--text-subtle)]" aria-hidden="true" />
                      <p className="mt-3 text-sm text-muted">
                        No coaching brief for this period yet. Generating one costs a fraction of a cent and it
                        is cached until your numbers change.
                      </p>
                      <Link
                        href="/coach"
                        className="mt-4 inline-flex h-10 items-center rounded-lg bg-[var(--accent)] px-4 text-sm font-medium text-[var(--accent-text)] hover:opacity-90"
                      >
                        Open AI Coach
                      </Link>
                    </div>
                  )}
                </CardBody>
              </Card>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
