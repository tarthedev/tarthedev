"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorNote } from "@/components/ui/empty";
import { TextInput } from "@/components/ui/field";
import { Badge } from "@/components/ui/status";

export interface KpiRow {
  id: string;
  key: string;
  displayName: string;
  category: string | null;
  unitType: string;
  aggregation: string;
  weight: number;
  active: boolean;
  aliases: string[];
}

/**
 * KPI definitions are data, not code. New KPIs can be added here or approved
 * straight from a snapshot when the AI spots an unfamiliar label.
 */
export function KpiManager({ kpis }: { kpis: KpiRow[] }) {
  const router = useRouter();
  const [weights, setWeights] = useState<Record<string, string>>(
    Object.fromEntries(kpis.map((k) => [k.id, String(k.weight)])),
  );
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function patch(id: string, body: Record<string, unknown>) {
    setBusy(id);
    setError(null);
    try {
      const response = await fetch(`/api/kpis/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(payload.error ?? "Could not update that KPI.");
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function create() {
    const displayName = newName.trim();
    if (!displayName) return;

    setBusy("new");
    setError(null);
    try {
      const response = await fetch("/api/kpis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error ?? "Could not create that KPI.");
        return;
      }
      setNewName("");
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const totalWeight = kpis.filter((k) => k.active).reduce((sum, k) => sum + k.weight, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>KPI definitions</CardTitle>
        <span className="text-[11px] text-subtle tnum">{kpis.filter((k) => k.active).length} active</span>
      </CardHeader>
      <CardBody className="space-y-4">
        {error && <ErrorNote>{error}</ErrorNote>}

        <p className="text-[13px] leading-relaxed text-muted">
          Weight sets how much each KPI counts toward your overall score. These are relative, not percentages —
          the app normalises them.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-[var(--border)] text-[11px] tracking-wide text-subtle uppercase">
                <th scope="col" className="pb-2 font-medium">KPI</th>
                <th scope="col" className="pb-2 font-medium">Key</th>
                <th scope="col" className="pb-2 text-right font-medium">Weight</th>
                <th scope="col" className="pb-2 text-right font-medium">Share</th>
                <th scope="col" className="pb-2 text-right font-medium">State</th>
              </tr>
            </thead>
            <tbody className="tnum">
              {kpis.map((kpi) => (
                <tr key={kpi.id} className="border-b border-[var(--border)] last:border-0">
                  <th scope="row" className="py-2.5 pr-3 text-left font-medium">
                    {kpi.displayName}
                    {kpi.aliases.length > 0 && (
                      <span className="ml-2 text-[11px] font-normal text-subtle">
                        aka {kpi.aliases.slice(0, 2).join(", ")}
                        {kpi.aliases.length > 2 && ` +${kpi.aliases.length - 2}`}
                      </span>
                    )}
                  </th>
                  <td className="py-2.5 pr-3 font-mono text-[11px] text-subtle">{kpi.key}</td>
                  <td className="py-2 pr-3 text-right">
                    <input
                      type="number"
                      min={0.1}
                      step={0.5}
                      aria-label={`${kpi.displayName} weight`}
                      value={weights[kpi.id] ?? ""}
                      onChange={(e) => setWeights((w) => ({ ...w, [kpi.id]: e.target.value }))}
                      onBlur={() => {
                        const value = Number.parseFloat(weights[kpi.id] ?? "");
                        if (Number.isFinite(value) && value > 0 && value !== kpi.weight) {
                          void patch(kpi.id, { weight: value });
                        }
                      }}
                      className="h-9 w-20 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-2 text-right text-sm tnum"
                    />
                  </td>
                  <td className="py-2.5 pr-3 text-right text-muted">
                    {kpi.active && totalWeight > 0 ? `${Math.round((kpi.weight / totalWeight) * 100)}%` : "—"}
                  </td>
                  <td className="py-2.5 text-right">
                    <button
                      type="button"
                      disabled={busy === kpi.id}
                      onClick={() => patch(kpi.id, { active: !kpi.active })}
                      className="disabled:opacity-50"
                    >
                      <Badge tone={kpi.active ? "positive" : "neutral"}>
                        {kpi.active ? "Active" : "Hidden"}
                      </Badge>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-2 border-t border-[var(--border)] pt-4 sm:flex-row sm:items-end">
          <TextInput
            label="Add a KPI"
            placeholder="e.g. Perks"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="sm:flex-1"
          />
          <Button variant="secondary" onClick={create} loading={busy === "new"} disabled={!newName.trim()}>
            <Plus className="size-4" aria-hidden="true" />
            Add
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
