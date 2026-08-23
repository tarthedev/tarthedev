"use client";

import { Minus, Plus } from "lucide-react";
import { useMemo, useState } from "react";

import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status";
import { formatPercent, formatValue } from "@/lib/format";
import { computePace, type UnitType } from "@/lib/kpi/pace";
import { calendarFromDates } from "@/lib/kpi/schedule";

export interface SimulatorKpi {
  key: string;
  displayName: string;
  unitType: UnitType;
  current: number;
  target: number;
  minimum: number | null;
  stretch: number | null;
}

export interface SimulatorPayload {
  periodStart: string;
  periodEnd: string;
  today: string;
  todayCounted: boolean;
  unitLabel: "day" | "shift";
  workingDates: string[];
  kpis: SimulatorKpi[];
}

/**
 * "If I sell one more" — re-runs the same pace engine the dashboard uses, in the
 * browser, with no server round-trip and no model call. Answers the question a
 * rep actually has thirty minutes before close.
 */
export function Simulator({ payload }: { payload: SimulatorPayload }) {
  const withGoals = payload.kpis.filter((k) => k.target > 0);
  const [selected, setSelected] = useState(withGoals[0]?.key ?? "");
  const [delta, setDelta] = useState(1);

  const calendar = useMemo(
    () => calendarFromDates(payload.workingDates, payload.unitLabel),
    [payload.workingDates, payload.unitLabel],
  );

  const kpi = withGoals.find((k) => k.key === selected) ?? withGoals[0];

  const { now, after } = useMemo(() => {
    if (!kpi) return { now: null, after: null };
    const input = {
      current: kpi.current,
      target: kpi.target,
      minimum: kpi.minimum,
      stretch: kpi.stretch,
      periodStart: payload.periodStart,
      periodEnd: payload.periodEnd,
      today: payload.today,
      calendar,
      todayCounted: payload.todayCounted,
      unitType: kpi.unitType,
    };
    return {
      now: computePace(input),
      after: computePace({ ...input, current: Math.max(0, kpi.current + delta) }),
    };
  }, [kpi, delta, calendar, payload]);

  if (!kpi || !now || !after) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>What if</CardTitle>
        </CardHeader>
        <CardBody>
          <p className="text-sm text-muted">Set a goal on a KPI to use the simulator.</p>
        </CardBody>
      </Card>
    );
  }

  const projectionDelta = after.projected - now.projected;

  return (
    <Card>
      <CardHeader>
        <CardTitle>What if</CardTitle>
      </CardHeader>
      <CardBody>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="sim-kpi" className="sr-only-focusable">
            KPI
          </label>
          <select
            id="sim-kpi"
            value={kpi.key}
            onChange={(e) => setSelected(e.target.value)}
            className="h-9 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-2 text-sm"
          >
            {withGoals.map((k) => (
              <option key={k.key} value={k.key}>
                {k.displayName}
              </option>
            ))}
          </select>

          <div className="inline-flex items-center rounded-lg border border-[var(--border-strong)]">
            <button
              type="button"
              onClick={() => setDelta((d) => Math.max(-20, d - 1))}
              aria-label="One fewer"
              className="inline-flex size-9 items-center justify-center text-[var(--text-muted)] hover:text-[var(--text)]"
            >
              <Minus className="size-4" aria-hidden="true" />
            </button>
            <span aria-live="polite" className="min-w-12 px-1 text-center text-sm font-medium tnum">
              {delta > 0 ? `+${delta}` : delta}
            </span>
            <button
              type="button"
              onClick={() => setDelta((d) => Math.min(20, d + 1))}
              aria-label="One more"
              className="inline-flex size-9 items-center justify-center text-[var(--text-muted)] hover:text-[var(--text)]"
            >
              <Plus className="size-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4">
          <Column
            heading="Now"
            value={formatValue(now.projected, kpi.unitType)}
            caption={`${formatPercent(now.projectedAttainmentPct)} of goal`}
            status={now.status}
          />
          <Column
            heading={`With ${delta > 0 ? `+${delta}` : delta}`}
            value={formatValue(after.projected, kpi.unitType)}
            caption={`${formatPercent(after.projectedAttainmentPct)} of goal`}
            status={after.status}
          />
        </div>

        <p className="mt-4 border-t border-[var(--border)] pt-3 text-[12px] leading-relaxed text-muted">
          {delta > 0
            ? `${delta} more ${kpi.displayName} ${
                projectionDelta > 0.05
                  ? `moves your projected finish to ${formatValue(after.projected, kpi.unitType)}`
                  : "does not change your projected finish"
              }${after.status !== now.status ? ` and takes you from ${now.status.replace("_", " ").toLowerCase()} to ${after.status.replace("_", " ").toLowerCase()}` : ""}.`
            : "Use the plus button to see what additional production does to your projection."}
        </p>
      </CardBody>
    </Card>
  );
}

function Column({
  heading,
  value,
  caption,
  status,
}: {
  heading: string;
  value: string;
  caption: string;
  status: Parameters<typeof StatusBadge>[0]["status"];
}) {
  return (
    <div>
      <p className="text-[11px] text-subtle">{heading}</p>
      <p className="mt-1 text-2xl leading-none font-semibold tnum">{value}</p>
      <p className="mt-1 text-[11px] text-subtle tnum">{caption}</p>
      <StatusBadge status={status} size="sm" className="mt-2" />
    </div>
  );
}
