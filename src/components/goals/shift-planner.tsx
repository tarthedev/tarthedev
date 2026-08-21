"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorNote } from "@/components/ui/empty";
import { cn } from "@/lib/cn";
import { DAY_NAMES, dayOfWeek, formatDateKey } from "@/lib/kpi/dates";
import type { ScheduleMode, ShiftKind } from "@/lib/kpi/schedule";

interface ShiftInput {
  date: string;
  kind: ShiftKind;
  hours: number | null;
}

const KINDS: { value: ShiftKind; label: string; short: string }[] = [
  { value: "WORK", label: "Working", short: "Work" },
  { value: "OFF", label: "Day off", short: "Off" },
  { value: "PTO", label: "PTO", short: "PTO" },
  { value: "HOLIDAY", label: "Holiday", short: "Hol" },
];

/**
 * Shift calendar for the period.
 *
 * This is what turns "1.0 per day" into "1.25 per remaining shift" — pacing
 * across days you are not working is not actionable.
 */
export function ShiftPlanner({
  dates,
  existing,
  scheduleMode,
}: {
  dates: string[];
  existing: ShiftInput[];
  scheduleMode: ScheduleMode;
}) {
  const router = useRouter();
  const byDate = new Map(existing.map((s) => [s.date, s]));

  const [draft, setDraft] = useState<Record<string, ShiftKind>>(
    Object.fromEntries(
      dates.map((date) => [
        date,
        byDate.get(date)?.kind ?? (scheduleMode === "shifts" ? "OFF" : "WORK"),
      ]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/shifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shifts: dates.map((date) => ({
            date,
            kind: draft[date] ?? "WORK",
            hours: byDate.get(date)?.hours ?? null,
          })),
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? "Could not save the schedule.");
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const workingCount = dates.filter((d) => draft[d] === "WORK").length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Schedule</CardTitle>
        <span className="text-[11px] text-subtle tnum">
          {workingCount} working {workingCount === 1 ? "day" : "days"} this period
        </span>
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="text-[13px] leading-relaxed text-muted">
          {scheduleMode === "shifts"
            ? "Shift mode: only days marked Working count as sellable units, so pacing is per remaining shift."
            : "Calendar mode: every day counts unless you mark it off. Switch to shift mode in Settings to pace per scheduled shift instead."}
        </p>

        {error && <ErrorNote>{error}</ErrorNote>}

        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {dates.map((date) => (
            <li key={date} className="rounded-lg border border-[var(--border)] p-2">
              <p className="text-[11px] font-medium text-subtle">
                {DAY_NAMES[dayOfWeek(date)]} {formatDateKey(date, "d")}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {KINDS.map((kind) => (
                  <button
                    key={kind.value}
                    type="button"
                    aria-pressed={draft[date] === kind.value}
                    aria-label={`${formatDateKey(date)}: ${kind.label}`}
                    onClick={() => setDraft((d) => ({ ...d, [date]: kind.value }))}
                    className={cn(
                      "rounded px-1.5 py-1 text-[10px] font-medium transition-colors",
                      draft[date] === kind.value
                        ? kind.value === "WORK"
                          ? "bg-[var(--positive-bg)] text-[var(--positive)]"
                          : "bg-[var(--neutral-bg)] text-[var(--neutral)]"
                        : "text-[var(--text-subtle)] hover:bg-[var(--surface-raised)]",
                    )}
                  >
                    {kind.short}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>

        <Button variant="secondary" onClick={save} loading={busy}>
          {saved ? "Schedule saved" : "Save schedule"}
        </Button>
      </CardBody>
    </Card>
  );
}
