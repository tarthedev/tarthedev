import Link from "next/link";
import type { Metadata } from "next";

import { GoalEditor, type GoalRow } from "@/components/goals/goal-editor";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { ShiftPlanner } from "@/components/goals/shift-planner";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, InfoNote } from "@/components/ui/empty";
import { requireUser } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { buildDashboard } from "@/lib/kpi/dashboard";
import { eachDate, utcToDateKey } from "@/lib/kpi/dates";
import { cn } from "@/lib/cn";
import type { PeriodType } from "@/lib/kpi/period";

export const metadata: Metadata = { title: "Goals" };
export const dynamic = "force-dynamic";

const PERIODS: { value: PeriodType; label: string }[] = [
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" },
];

export default async function GoalsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; onboarding?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const periodType = (PERIODS.find((p) => p.value === params.period)?.value ??
    "WEEKLY") as Exclude<PeriodType, "CUSTOM">;

  const data = await buildDashboard(user.id, user.timezone, { periodType });
  const shifts = await prisma.shift.findMany({
    where: {
      userId: user.id,
      date: {
        gte: new Date(`${data.period.start}T00:00:00.000Z`),
        lte: new Date(`${data.period.end}T00:00:00.000Z`),
      },
    },
    select: { date: true, kind: true, hours: true },
  });

  const rows: GoalRow[] = data.rows.map((row) => ({
    kpiId: row.kpiId,
    key: row.key,
    displayName: row.displayName,
    unitType: row.unitType,
    goalId: row.goalId,
    minimum: row.minimumValue,
    target: row.targetValue,
    stretch: row.stretchValue,
    priority: row.priority,
  }));

  return (
    <div>
      <PageHeader
        title="Goals"
        description={`Targets for ${data.period.label}. Minimum and stretch are optional — the target is what pacing measures against.`}
        actions={
          <div className="inline-flex rounded-lg border border-[var(--border)] p-0.5">
            {PERIODS.map((option) => (
              <Link
                key={option.value}
                href={`/goals?period=${option.value}`}
                aria-current={periodType === option.value ? "page" : undefined}
                className={cn(
                  "inline-flex h-8 items-center rounded-md px-3 text-[12px] font-medium",
                  periodType === option.value
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
        {params.onboarding === "1" && (
          <InfoNote>
            Account created. Set your targets below, then head to{" "}
            <Link href="/upload" className="underline underline-offset-2">
              Upload
            </Link>{" "}
            with your first batch of KPI screenshots.
          </InfoNote>
        )}

        {rows.length === 0 ? (
          <Card>
            <EmptyState
              title="No KPIs defined"
              description="Add the KPIs your Victra dashboard tracks, then set a target for each one."
              action={{ label: "Manage KPIs", href: "/settings#kpis" }}
            />
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>{PERIODS.find((p) => p.value === periodType)?.label} targets</CardTitle>
              <span className="text-[11px] text-subtle">{data.period.label}</span>
            </CardHeader>
            <CardBody>
              <GoalEditor rows={rows} periodType={periodType} />
            </CardBody>
          </Card>
        )}

        <ShiftPlanner
          dates={eachDate(data.period.start, data.period.end)}
          existing={shifts.map((s) => ({
            date: utcToDateKey(s.date),
            kind: s.kind,
            hours: s.hours,
          }))}
          scheduleMode={data.settings.scheduleMode}
        />
      </PageBody>
    </div>
  );
}
