"use client";

import { useState } from "react";
import { RefreshCw, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorNote, InfoNote } from "@/components/ui/empty";
import { StatusBadge } from "@/components/ui/status";
import type { CoachBrief } from "@/lib/ai/schemas";
import { formatUsd } from "@/lib/format";
import type { PaceStatus } from "@/lib/kpi/pace";

interface CoachResponse {
  brief: CoachBrief;
  model: string;
  generatedAt: string;
  cached: boolean;
  costUsd: number;
  budgetWarning: string | null;
}

const IMPACT_TONE = {
  HIGH: "text-[var(--negative)]",
  MEDIUM: "text-[var(--warning)]",
  LOW: "text-[var(--text-subtle)]",
} as const;

export function CoachView({
  initial,
  initialGeneratedAt,
}: {
  initial: CoachBrief | null;
  initialGeneratedAt: string | null;
}) {
  const [brief, setBrief] = useState<CoachBrief | null>(initial);
  const [meta, setMeta] = useState<{ model: string; generatedAt: string; cached: boolean; cost: number } | null>(
    initialGeneratedAt ? { model: "cached", generatedAt: initialGeneratedAt, cached: true, cost: 0 } : null,
  );
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function generate(force: boolean) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/ai/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(body.detail ? `${body.error} ${body.detail}` : (body.error ?? "Could not generate a brief."));
        return;
      }

      const data = body as CoachResponse;
      setBrief(data.brief);
      setMeta({
        model: data.model,
        generatedAt: data.generatedAt,
        cached: data.cached,
        cost: data.costUsd,
      });
      setWarning(data.budgetWarning);
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {error && <ErrorNote>{error}</ErrorNote>}
      {warning && <InfoNote tone="warning">{warning}</InfoNote>}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={() => generate(false)} loading={busy}>
          <Sparkles className="size-4" aria-hidden="true" />
          {brief ? "Refresh if numbers changed" : "Generate coaching brief"}
        </Button>
        {brief && (
          <Button variant="ghost" onClick={() => generate(true)} loading={busy}>
            <RefreshCw className="size-4" aria-hidden="true" />
            Force regenerate
          </Button>
        )}
        {meta && (
          <p className="text-[12px] text-subtle tnum">
            {meta.cached ? "From cache · no cost" : `${meta.model} · ${formatUsd(meta.cost)}`}
          </p>
        )}
      </div>

      {!brief ? (
        <Card>
          <CardBody className="pt-5">
            <p className="text-sm leading-relaxed text-muted">
              The coach reads only the computed summary of your period — current values, goals, remaining units,
              required pace, and projections — never the raw database. That keeps each brief to a few hundred
              tokens, and the result is cached until your numbers actually change.
            </p>
          </CardBody>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Overall status</CardTitle>
              <StatusBadge status={brief.overall_status as PaceStatus} />
            </CardHeader>
            <CardBody>
              <p className="text-[15px] leading-relaxed">{brief.headline}</p>
            </CardBody>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Highlight title="Biggest win" kpi={brief.biggest_win.kpi} reason={brief.biggest_win.reason} tone="positive" />
            <Highlight
              title="Biggest problem"
              kpi={brief.biggest_problem.kpi}
              reason={brief.biggest_problem.reason}
              tone="negative"
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Today&apos;s priorities</CardTitle>
            </CardHeader>
            <CardBody>
              <ol className="space-y-4">
                {brief.priorities.map((priority, index) => (
                  <li key={priority.action} className="flex gap-3">
                    <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--surface-raised)] text-[12px] font-semibold tnum">
                      {index + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{priority.action}</p>
                      <p className="mt-1 text-[13px] leading-relaxed text-muted">{priority.why}</p>
                      <p className={`mt-1 text-[11px] font-medium ${IMPACT_TONE[priority.impact]}`}>
                        {priority.impact} impact
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Opportunity</CardTitle>
              </CardHeader>
              <CardBody>
                <p className="text-sm leading-relaxed">{brief.opportunity}</p>
              </CardBody>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Forecast</CardTitle>
              </CardHeader>
              <CardBody>
                <p className="text-sm leading-relaxed">{brief.forecast}</p>
              </CardBody>
            </Card>
          </div>

          <Card className="border-[var(--accent)]">
            <CardHeader>
              <CardTitle>One thing to fix today</CardTitle>
            </CardHeader>
            <CardBody>
              <p className="text-[15px] leading-relaxed font-medium">{brief.one_thing}</p>
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}

function Highlight({
  title,
  kpi,
  reason,
  tone,
}: {
  title: string;
  kpi: string;
  reason: string;
  tone: "positive" | "negative";
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardBody>
        <p
          className={`text-lg font-semibold ${tone === "positive" ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}
        >
          {kpi}
        </p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{reason}</p>
      </CardBody>
    </Card>
  );
}
