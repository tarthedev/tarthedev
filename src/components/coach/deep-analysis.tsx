"use client";

import { useState } from "react";
import { Microscope } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorNote } from "@/components/ui/empty";
import { TextInput } from "@/components/ui/field";
import { formatUsd } from "@/lib/format";

/**
 * The deliberate, expensive path. Routed to the deep-analysis model, never run
 * automatically, and never on page load — the button is the whole point.
 */
export function DeepAnalysis() {
  const [focus, setFocus] = useState("");
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ model: string; cost: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/ai/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ focus: focus.trim() || undefined }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(body.detail ? `${body.error} ${body.detail}` : (body.error ?? "Analysis failed."));
        return;
      }
      setAnalysis(body.analysis);
      setMeta({ model: body.model, cost: body.costUsd });
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Deep analysis</CardTitle>
        <Microscope className="size-4 text-[var(--text-subtle)]" aria-hidden="true" />
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="text-[13px] leading-relaxed text-muted">
          Runs the higher-capability model across several periods of history for a strategic review. This is the
          only feature that uses the expensive model, and only when you press the button.
        </p>

        {error && <ErrorNote>{error}</ErrorNote>}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <TextInput
            label="Focus (optional)"
            placeholder="e.g. why my Internet keeps slipping late in the week"
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
            className="sm:flex-1"
          />
          <Button variant="secondary" onClick={run} loading={busy} className="sm:w-40">
            Run analysis
          </Button>
        </div>

        {analysis && (
          <div className="rounded-lg bg-[var(--surface-raised)] p-4">
            <div className="space-y-3 text-[14px] leading-relaxed whitespace-pre-wrap">{analysis}</div>
            {meta && (
              <p className="mt-4 border-t border-[var(--border)] pt-3 text-[11px] text-subtle tnum">
                {meta.model} · {formatUsd(meta.cost)}
              </p>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
