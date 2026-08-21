"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, Check, HelpCircle, Pencil, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorNote, InfoNote } from "@/components/ui/empty";
import { Badge } from "@/components/ui/status";
import { cn } from "@/lib/cn";
import { confidenceBand } from "@/lib/kpi/validate";

export interface ReviewObservation {
  id: string;
  rawLabel: string;
  rawValue: string;
  value: number | null;
  aiValue: number | null;
  confidence: number;
  status: "PENDING" | "ACCEPTED" | "REJECTED" | "CONFLICT" | "UNMAPPED";
  isCorrected: boolean;
  notes: string | null;
  sourceImageLabel: string | null;
  sourceImageId: string | null;
  kpi: { id: string; key: string; displayName: string } | null;
}

export interface KpiOption {
  id: string;
  key: string;
  displayName: string;
}

const BAND_TONE = {
  high: "positive",
  good: "positive",
  uncertain: "warning",
  questionable: "negative",
} as const;

/**
 * Human-in-the-loop verification.
 *
 * Low-confidence readings, conflicts between screenshots, and KPIs the system
 * has never seen all land here rather than being silently written to the
 * database. Accepting is one tap; correcting preserves what the model said.
 */
export function ReviewPanel({
  snapshotId,
  observations,
  kpiOptions,
  imageUrlFor,
}: {
  snapshotId: string;
  observations: ReviewObservation[];
  kpiOptions: KpiOption[];
  imageUrlFor: (imageId: string) => string;
}) {
  const router = useRouter();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pending = observations.filter((o) => o.status !== "ACCEPTED" && o.status !== "REJECTED");
  const settled = observations.filter((o) => o.status === "ACCEPTED" || o.status === "REJECTED");

  const conflicts = new Map<string, ReviewObservation[]>();
  for (const observation of pending) {
    if (observation.status !== "CONFLICT") continue;
    const key = observation.kpi?.key ?? observation.rawLabel;
    const bucket = conflicts.get(key);
    if (bucket) bucket.push(observation);
    else conflicts.set(key, [observation]);
  }
  const conflictIds = new Set([...conflicts.values()].flat().map((o) => o.id));
  const simple = pending.filter((o) => !conflictIds.has(o.id));

  async function send(body: unknown, tag: string) {
    setBusy(tag);
    setError(null);
    try {
      const response = await fetch(`/api/snapshots/${snapshotId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.detail ? `${payload.error} ${payload.detail}` : (payload.error ?? "Could not save."));
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const decide = (observation: ReviewObservation, action: "ACCEPT" | "REJECT" | "CORRECT") => {
    const edited = edits[observation.id];
    const value = action === "CORRECT" ? Number.parseFloat(edited ?? "") : undefined;
    if (action === "CORRECT" && (edited === undefined || !Number.isFinite(value))) {
      setError("Enter a number before saving the correction.");
      return;
    }
    return send(
      {
        decisions: [
          {
            observationId: observation.id,
            action,
            ...(action === "CORRECT" ? { value } : {}),
            ...(assignments[observation.id] ? { kpiId: assignments[observation.id] } : {}),
          },
        ],
      },
      observation.id,
    );
  };

  return (
    <div className="space-y-5">
      {error && <ErrorNote>{error}</ErrorNote>}

      {pending.length > 0 && (
        <InfoNote tone="warning">
          {pending.length} reading{pending.length === 1 ? "" : "s"} need your confirmation before they count
          toward the dashboard.
        </InfoNote>
      )}

      {conflicts.size > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Conflicts</CardTitle>
            <AlertTriangle className="size-4 text-[var(--warning)]" aria-hidden="true" />
          </CardHeader>
          <CardBody className="space-y-5">
            <p className="text-[13px] leading-relaxed text-muted">
              Two screenshots disagree about the same KPI. That usually means they were taken at different times
              or show different reporting periods. Pick the reading that is correct — the system will not guess.
            </p>

            {[...conflicts.entries()].map(([key, readings]) => (
              <div key={key} className="rounded-lg border border-[var(--warning)] bg-[var(--warning-bg)]/30 p-4">
                <p className="text-sm font-semibold">{readings[0]?.kpi?.displayName ?? readings[0]?.rawLabel}</p>
                <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                  {readings.map((reading) => (
                    <li key={reading.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                      <p className="text-2xl leading-none font-semibold tnum">{reading.value ?? "—"}</p>
                      <p className="mt-1.5 text-[11px] text-subtle">
                        {reading.sourceImageLabel ?? "unknown source"} · {Math.round(reading.confidence * 100)}%
                        confidence
                      </p>
                      {reading.sourceImageId && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={imageUrlFor(reading.sourceImageId)}
                          alt={`Source screenshot for ${reading.rawLabel}`}
                          className="mt-2 h-24 w-full rounded border border-[var(--border)] object-cover object-top"
                          loading="lazy"
                        />
                      )}
                      <Button
                        size="sm"
                        variant="primary"
                        className="mt-3 w-full"
                        loading={busy === reading.id}
                        onClick={() => decide(reading, "ACCEPT")}
                      >
                        Use this value
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      {simple.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Needs review</CardTitle>
            <Button
              size="sm"
              variant="secondary"
              loading={busy === "acceptAll"}
              onClick={() => send({ mode: "acceptAll" }, "acceptAll")}
            >
              Accept all
            </Button>
          </CardHeader>
          <CardBody className="space-y-3">
            {simple.map((observation) => {
              const band = confidenceBand(observation.confidence);
              const unmapped = observation.status === "UNMAPPED";

              return (
                <div key={observation.id} className="rounded-lg border border-[var(--border)] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-sm font-medium">
                        {observation.kpi?.displayName ?? observation.rawLabel}
                        {unmapped && (
                          <Badge tone="info">
                            <HelpCircle className="mr-1 inline size-3" aria-hidden="true" />
                            New KPI detected
                          </Badge>
                        )}
                      </p>
                      <p className="mt-1 text-[11px] text-subtle">
                        Read as &quot;{observation.rawValue}&quot; from {observation.sourceImageLabel ?? "an unknown screenshot"}
                      </p>
                      {observation.notes && (
                        <p className="mt-1 text-[12px] text-[var(--warning)]">{observation.notes}</p>
                      )}
                    </div>
                    <Badge tone={BAND_TONE[band]}>{Math.round(observation.confidence * 100)}% confident</Badge>
                  </div>

                  {observation.sourceImageId && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={imageUrlFor(observation.sourceImageId)}
                      alt={`Screenshot containing ${observation.rawLabel}`}
                      className="mt-3 h-28 w-full rounded border border-[var(--border)] object-cover object-top sm:h-32"
                      loading="lazy"
                    />
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {unmapped && (
                      <select
                        aria-label={`Assign ${observation.rawLabel} to a KPI`}
                        value={assignments[observation.id] ?? ""}
                        onChange={(e) =>
                          setAssignments((a) => ({ ...a, [observation.id]: e.target.value }))
                        }
                        className="h-9 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-2 text-sm"
                      >
                        <option value="">Choose a KPI…</option>
                        {kpiOptions.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.displayName}
                          </option>
                        ))}
                      </select>
                    )}

                    <input
                      type="number"
                      step="any"
                      aria-label={`Value for ${observation.rawLabel}`}
                      value={edits[observation.id] ?? String(observation.value ?? "")}
                      onChange={(e) => setEdits((s) => ({ ...s, [observation.id]: e.target.value }))}
                      className="h-9 w-24 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-2 text-right text-sm tnum"
                    />

                    <Button
                      size="sm"
                      variant="primary"
                      loading={busy === observation.id}
                      disabled={unmapped && !assignments[observation.id]}
                      onClick={() =>
                        decide(
                          observation,
                          edits[observation.id] !== undefined &&
                            Number.parseFloat(edits[observation.id] as string) !== observation.value
                            ? "CORRECT"
                            : "ACCEPT",
                        )
                      }
                    >
                      <Check className="size-3.5" aria-hidden="true" />
                      Accept
                    </Button>

                    {unmapped && (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={busy === `create-${observation.id}`}
                        onClick={() =>
                          send(
                            { mode: "createKpi", observationId: observation.id },
                            `create-${observation.id}`,
                          )
                        }
                      >
                        Create &quot;{observation.rawLabel}&quot;
                      </Button>
                    )}

                    <Button
                      size="sm"
                      variant="ghost"
                      loading={busy === observation.id}
                      onClick={() => decide(observation, "REJECT")}
                    >
                      <X className="size-3.5" aria-hidden="true" />
                      Discard
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardBody>
        </Card>
      )}

      {settled.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recorded values</CardTitle>
          </CardHeader>
          <CardBody className="overflow-x-auto p-0">
            <table className="w-full min-w-[560px] text-left text-[13px]">
              <thead>
                <tr className="border-y border-[var(--border)] bg-[var(--surface-raised)] text-[11px] tracking-wide text-subtle uppercase">
                  <th scope="col" className="px-5 py-2.5 font-medium">KPI</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Value</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">AI read</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Confidence</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Source</th>
                  <th scope="col" className="px-5 py-2.5 text-right font-medium">State</th>
                </tr>
              </thead>
              <tbody className="tnum">
                {settled.map((observation) => (
                  <tr key={observation.id} className="border-b border-[var(--border)] last:border-0">
                    <th scope="row" className="px-5 py-2.5 text-left font-medium">
                      {observation.kpi?.displayName ?? observation.rawLabel}
                    </th>
                    <td
                      className={cn(
                        "px-3 py-2.5 text-right font-medium",
                        observation.status === "REJECTED" && "text-subtle line-through",
                      )}
                    >
                      {observation.value ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right text-subtle">
                      {observation.isCorrected ? (observation.aiValue ?? "—") : ""}
                    </td>
                    <td className="px-3 py-2.5 text-right text-muted">
                      {Math.round(observation.confidence * 100)}%
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[11px] text-subtle">
                      {observation.sourceImageLabel ?? "—"}
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      {observation.status === "REJECTED" ? (
                        <Badge tone="neutral">Discarded</Badge>
                      ) : observation.isCorrected ? (
                        <Badge tone="info">
                          <Pencil className="mr-1 inline size-3" aria-hidden="true" />
                          Corrected
                        </Badge>
                      ) : (
                        <Badge tone="positive">Accepted</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
