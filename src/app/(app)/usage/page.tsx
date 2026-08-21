import type { Metadata } from "next";

import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress";
import { Badge } from "@/components/ui/status";
import { InfoNote } from "@/components/ui/empty";
import { getUsageSummary } from "@/lib/ai/usage";
import { requireUser } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { isMockAi } from "@/lib/env";
import { formatTokens, formatUsd, formatRelative } from "@/lib/format";
import { getSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "AI Cost" };
export const dynamic = "force-dynamic";

const FEATURE_LABEL: Record<string, string> = {
  SCREENSHOT_EXTRACTION: "Screenshot extraction",
  COACH_BRIEF: "Coaching brief",
  CHAT: "Questions",
  DEEP_ANALYSIS: "Deep analysis",
};

export default async function UsagePage() {
  const user = await requireUser();
  const settings = await getSettings(user.id);

  const [summary, recent] = await Promise.all([
    getUsageSummary(user.id, user.timezone, settings.monthlyBudgetUsd),
    prisma.aiRequest.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  ]);

  const overBudget = summary.monthlyBudgetUsd > 0 && summary.month.costUsd >= summary.monthlyBudgetUsd;
  const projectedOver =
    summary.monthlyBudgetUsd > 0 && summary.projectedMonthCostUsd > summary.monthlyBudgetUsd;

  return (
    <div>
      <PageHeader
        title="AI cost"
        description="Every model call is logged with its token counts and estimated cost. Costs are estimates from a local price table, not an invoice — check your Anthropic console for billing."
      />
      <PageBody>
        {isMockAi() && (
          <InfoNote tone="warning">
            Development mode is on, so these figures are simulated by the mock provider rather than real spend.
          </InfoNote>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Today" value={formatUsd(summary.today.costUsd)} sub={`${summary.today.requests} requests`} />
          <Metric label="This week" value={formatUsd(summary.week.costUsd)} sub={`${summary.week.requests} requests`} />
          <Metric label="This month" value={formatUsd(summary.month.costUsd)} sub={`${summary.month.requests} requests`} />
          <Metric
            label="All time"
            value={formatUsd(summary.allTime.costUsd)}
            sub={`${summary.allTime.requests} requests`}
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Monthly budget</CardTitle>
            <span className="text-[11px] text-subtle tnum">
              {formatUsd(summary.month.costUsd)} of {formatUsd(summary.monthlyBudgetUsd)}
            </span>
          </CardHeader>
          <CardBody>
            <ProgressBar
              value={summary.budgetUsedPct}
              status={overBudget ? "BEHIND" : summary.budgetUsedPct >= 80 ? "AT_RISK" : "ON_TRACK"}
              label="Monthly AI budget used"
            />
            <div className="mt-2 flex justify-between text-[12px] text-muted tnum">
              <span>{summary.budgetUsedPct}% used</span>
              <span>Projected month end: {formatUsd(summary.projectedMonthCostUsd)}</span>
            </div>

            <div className="mt-4 space-y-2 rounded-lg bg-[var(--surface-raised)] p-3 text-[12px] leading-relaxed text-muted">
              <p className="font-medium text-[var(--text)]">How spending is controlled</p>
              <ul className="space-y-1">
                <li>Routine extraction and coaching run on the cheaper model; the expensive model is reserved for retries and deep analysis you ask for.</li>
                <li>Above 80% of budget, routine requests are downgraded automatically.</li>
                <li>Over budget, optional AI stops and only screenshot extraction continues — up to a hard cap of {formatUsd(summary.monthlyBudgetUsd * 1.25)}, after which nothing runs.</li>
                <li>Coaching briefs are cached against a fingerprint of your numbers, so re-opening a page never re-bills.</li>
              </ul>
            </div>

            {(overBudget || projectedOver) && (
              <p className="mt-3 text-[12px] text-[var(--warning)]">
                {overBudget
                  ? "You are over the monthly budget. Optional AI features are paused until next month or until you raise the budget in Settings."
                  : "At the current rate this month will exceed the budget. Routine requests will be downgraded automatically."}
              </p>
            )}
          </CardBody>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Breakdown title="Cost by model" rows={summary.byModel} total={summary.month.costUsd} mono />
          <Breakdown
            title="Cost by feature"
            rows={summary.byFeature.map((r) => ({ ...r, label: FEATURE_LABEL[r.label] ?? r.label }))}
            total={summary.month.costUsd}
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Recent requests</CardTitle>
            <span className="text-[11px] text-subtle tnum">
              {formatTokens(summary.cacheSavingsTokens)} tokens served from cache this month
            </span>
          </CardHeader>
          <CardBody className="overflow-x-auto p-0">
            <table className="w-full min-w-[720px] text-left text-[12px]">
              <thead>
                <tr className="border-y border-[var(--border)] bg-[var(--surface-raised)] text-[10px] tracking-wide text-subtle uppercase">
                  <th scope="col" className="px-5 py-2 font-medium">When</th>
                  <th scope="col" className="px-3 py-2 font-medium">Feature</th>
                  <th scope="col" className="px-3 py-2 font-medium">Model</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">In</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Out</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Cached</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Latency</th>
                  <th scope="col" className="px-5 py-2 text-right font-medium">Cost</th>
                </tr>
              </thead>
              <tbody className="tnum">
                {recent.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-5 py-6 text-muted">
                      No AI requests yet.
                    </td>
                  </tr>
                ) : (
                  recent.map((request) => (
                    <tr key={request.id} className="border-b border-[var(--border)] last:border-0">
                      <td className="px-5 py-2 text-muted">{formatRelative(request.createdAt)}</td>
                      <td className="px-3 py-2">
                        {request.success ? (
                          FEATURE_LABEL[request.feature] ?? request.feature
                        ) : (
                          <span className="inline-flex items-center gap-1.5">
                            {FEATURE_LABEL[request.feature] ?? request.feature}
                            <Badge tone="negative">failed</Badge>
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-[11px] text-muted">{request.model}</td>
                      <td className="px-3 py-2 text-right text-muted">{formatTokens(request.inputTokens)}</td>
                      <td className="px-3 py-2 text-right text-muted">{formatTokens(request.outputTokens)}</td>
                      <td className="px-3 py-2 text-right text-muted">
                        {request.cacheReadTokens > 0 ? formatTokens(request.cacheReadTokens) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right text-muted">
                        {request.latencyMs > 0 ? `${(request.latencyMs / 1000).toFixed(1)}s` : "—"}
                      </td>
                      <td className="px-5 py-2 text-right font-medium">{formatUsd(request.estimatedCostUsd)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </CardBody>
        </Card>
      </PageBody>
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="card p-4">
      <p className="text-[11px] tracking-wide text-subtle uppercase">{label}</p>
      <p className="mt-1.5 text-2xl leading-none font-semibold tracking-tight tnum">{value}</p>
      <p className="mt-1.5 text-[11px] text-subtle tnum">{sub}</p>
    </div>
  );
}

function Breakdown({
  title,
  rows,
  total,
  mono = false,
}: {
  title: string;
  rows: { label: string; costUsd: number; requests: number }[];
  total: number;
  mono?: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardBody>
        {rows.length === 0 ? (
          <p className="text-sm text-muted">Nothing recorded this month.</p>
        ) : (
          <ul className="space-y-3">
            {rows.map((row) => (
              <li key={row.label}>
                <div className="flex items-baseline justify-between gap-3 text-[12px]">
                  <span className={mono ? "truncate font-mono" : "truncate"}>{row.label}</span>
                  <span className="tnum">
                    {formatUsd(row.costUsd)}
                    <span className="ml-2 text-subtle">{row.requests}×</span>
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
                  <div
                    className="h-full rounded-full bg-[var(--accent)]"
                    style={{ width: `${total > 0 ? Math.min(100, (row.costUsd / total) * 100) : 0}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
