import type { Metadata } from "next";

import { CoachView } from "@/components/coach/coach-view";
import { DeepAnalysis } from "@/components/coach/deep-analysis";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { formatRate, formatValue } from "@/lib/format";
import { buildDashboard } from "@/lib/kpi/dashboard";
import { STATUS_LABEL } from "@/lib/kpi/pace";
import type { CoachBrief } from "@/lib/ai/schemas";

export const metadata: Metadata = { title: "AI Coach" };
export const dynamic = "force-dynamic";

export default async function CoachPage() {
  const user = await requireUser();
  const data = await buildDashboard(user.id, user.timezone);

  // Read-only: rendering this page never triggers a model call.
  const cached = await prisma.coachBrief.findFirst({
    where: {
      userId: user.id,
      kind: "DAILY_BRIEF",
      cacheKey: `${data.period.start}:${data.period.end}`,
    },
    select: { content: true, generatedAt: true },
  });

  const withGoals = data.rows.filter((r) => r.targetValue > 0);

  return (
    <div>
      <PageHeader
        title="AI Coach"
        description={`Coaching for ${data.period.label}, grounded in your confirmed numbers. Every figure below is computed by the app — the model writes judgement, not arithmetic.`}
      />
      <PageBody>
        <Card>
          <CardHeader>
            <CardTitle>The numbers the coach is reading</CardTitle>
          </CardHeader>
          <CardBody className="overflow-x-auto">
            {withGoals.length === 0 ? (
              <p className="text-sm text-muted">
                No KPIs have goals for this period yet, so there is nothing to coach against.
              </p>
            ) : (
              <table className="w-full min-w-[560px] text-left text-[13px]">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[11px] tracking-wide text-subtle uppercase">
                    <th scope="col" className="pb-2 font-medium">KPI</th>
                    <th scope="col" className="pb-2 text-right font-medium">Current</th>
                    <th scope="col" className="pb-2 text-right font-medium">Goal</th>
                    <th scope="col" className="pb-2 text-right font-medium">Need/{data.unitLabel}</th>
                    <th scope="col" className="pb-2 text-right font-medium">Projected</th>
                    <th scope="col" className="pb-2 text-right font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="tnum">
                  {withGoals.map((row) => (
                    <tr key={row.key} className="border-b border-[var(--border)] last:border-0">
                      <td className="py-2 font-medium">{row.displayName}</td>
                      <td className="py-2 text-right">{formatValue(row.pace.current, row.unitType)}</td>
                      <td className="py-2 text-right text-muted">{formatValue(row.pace.target, row.unitType)}</td>
                      <td className="py-2 text-right">{formatRate(row.pace.requiredRate, row.pace.unitLabel, row.unitType)}</td>
                      <td className="py-2 text-right">{formatValue(row.pace.projected, row.unitType)}</td>
                      <td className="py-2 text-right text-muted">{STATUS_LABEL[row.pace.status]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>

        <CoachView
          initial={(cached?.content as CoachBrief | undefined) ?? null}
          initialGeneratedAt={cached?.generatedAt.toISOString() ?? null}
        />

        <DeepAnalysis />
      </PageBody>
    </div>
  );
}
