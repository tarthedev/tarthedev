"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ErrorNote } from "@/components/ui/empty";
import { cn } from "@/lib/cn";

export interface GoalRow {
  kpiId: string;
  key: string;
  displayName: string;
  unitType: string;
  goalId: string | null;
  minimum: number | null;
  target: number;
  stretch: number | null;
  priority: number;
}

type PeriodType = "DAILY" | "WEEKLY" | "MONTHLY";

/**
 * Inline goal editing. Saving a row upserts the goal for the current period and
 * immediately re-renders the server components that depend on it.
 */
export function GoalEditor({ rows, periodType }: { rows: GoalRow[]; periodType: PeriodType }) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, { minimum: string; target: string; stretch: string }>>(
    Object.fromEntries(
      rows.map((row) => [
        row.kpiId,
        {
          minimum: row.minimum === null ? "" : String(row.minimum),
          target: row.target > 0 ? String(row.target) : "",
          stretch: row.stretch === null ? "" : String(row.stretch),
        },
      ]),
    ),
  );
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const update = (kpiId: string, field: "minimum" | "target" | "stretch", value: string) => {
    setDrafts((current) => ({
      ...current,
      [kpiId]: { ...(current[kpiId] ?? { minimum: "", target: "", stretch: "" }), [field]: value },
    }));
  };

  async function save(row: GoalRow) {
    const draft = drafts[row.kpiId];
    if (!draft) return;

    const target = Number.parseFloat(draft.target);
    if (!Number.isFinite(target) || target < 0) {
      setError(`Enter a target for ${row.displayName} before saving.`);
      return;
    }

    setError(null);
    setSavingId(row.kpiId);

    try {
      const response = await fetch("/api/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kpiId: row.kpiId,
          periodType,
          targetValue: target,
          minimumValue: draft.minimum === "" ? null : Number.parseFloat(draft.minimum),
          stretchValue: draft.stretch === "" ? null : Number.parseFloat(draft.stretch),
          priority: row.priority,
        }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(body.error ?? `Could not save the ${row.displayName} goal.`);
        return;
      }

      setSavedId(row.kpiId);
      setTimeout(() => setSavedId((id) => (id === row.kpiId ? null : id)), 2000);
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="space-y-3">
      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px] text-left text-[13px]">
          <thead>
            <tr className="border-b border-[var(--border)] text-[11px] tracking-wide text-subtle uppercase">
              <th scope="col" className="pb-2 font-medium">KPI</th>
              <th scope="col" className="pb-2 text-right font-medium">Minimum</th>
              <th scope="col" className="pb-2 text-right font-medium">Target</th>
              <th scope="col" className="pb-2 text-right font-medium">Stretch</th>
              <th scope="col" className="pb-2 text-right font-medium">
                <span className="sr-only-focusable">Save</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const draft = drafts[row.kpiId] ?? { minimum: "", target: "", stretch: "" };
              return (
                <tr key={row.kpiId} className="border-b border-[var(--border)] last:border-0">
                  <th scope="row" className="py-2.5 pr-3 text-left font-medium">
                    {row.displayName}
                    <span className="ml-2 font-mono text-[11px] font-normal text-subtle">{row.key}</span>
                  </th>
                  {(["minimum", "target", "stretch"] as const).map((field) => (
                    <td key={field} className="py-2 pl-2">
                      <input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="any"
                        aria-label={`${row.displayName} ${field}`}
                        value={draft[field]}
                        onChange={(e) => update(row.kpiId, field, e.target.value)}
                        placeholder={field === "target" ? "—" : "opt"}
                        className={cn(
                          "h-9 w-20 rounded-lg border bg-[var(--surface)] px-2 text-right text-sm tnum",
                          field === "target"
                            ? "border-[var(--border-strong)]"
                            : "border-[var(--border)] text-muted",
                        )}
                      />
                    </td>
                  ))}
                  <td className="py-2 pl-3 text-right">
                    <Button
                      size="sm"
                      variant={savedId === row.kpiId ? "primary" : "secondary"}
                      onClick={() => save(row)}
                      disabled={savingId !== null}
                    >
                      {savingId === row.kpiId ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                      ) : savedId === row.kpiId ? (
                        <>
                          <Check className="size-3.5" aria-hidden="true" />
                          Saved
                        </>
                      ) : (
                        "Save"
                      )}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
