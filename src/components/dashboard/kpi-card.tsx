import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { ProgressBar } from "@/components/ui/progress";
import { StatusBadge } from "@/components/ui/status";
import { formatPercent, formatRate, formatValue } from "@/lib/format";
import type { KpiRow } from "@/lib/kpi/dashboard";

/**
 * The unit of the dashboard: where you are, what is left, what today needs, and
 * where this finishes. Every number here comes from the pace engine.
 */
export function KpiCard({ row }: { row: KpiRow }) {
  const { pace } = row;
  const hasGoal = row.targetValue > 0;

  return (
    <Link
      href={`/kpi/${row.key}`}
      className="card group flex flex-col p-4 transition-colors hover:border-[var(--border-strong)]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{row.displayName}</h3>
          {row.category && <p className="mt-0.5 text-[11px] text-subtle">{row.category}</p>}
        </div>
        <StatusBadge status={pace.status} size="sm" />
      </div>

      <div className="mt-3 flex items-baseline gap-1.5 tnum">
        <span className="text-[28px] leading-none font-semibold tracking-tight">
          {formatValue(pace.current, row.unitType)}
        </span>
        {hasGoal && (
          <span className="text-sm text-subtle">/ {formatValue(pace.target, row.unitType)}</span>
        )}
      </div>

      {hasGoal ? (
        <>
          <div className="mt-3">
            <ProgressBar
              value={pace.attainmentPct}
              status={pace.status}
              paceMarkerPct={pace.unitsTotal > 0 ? (pace.unitsEngaged / pace.unitsTotal) * 100 : null}
              label={`${row.displayName} attainment`}
            />
            <div className="mt-1.5 flex justify-between text-[11px] text-subtle tnum">
              <span>{formatPercent(pace.attainmentPct)}</span>
              <span>{formatValue(pace.remaining, row.unitType)} to go</span>
            </div>
          </div>

          <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-[var(--border)] pt-3 text-[11px]">
            <Stat label={`Need/${pace.unitLabel}`} value={formatRate(pace.requiredRate, pace.unitLabel, row.unitType)} />
            <Stat label={`Pace/${pace.unitLabel}`} value={formatRate(pace.currentRate, pace.unitLabel, row.unitType)} />
            <Stat label="Projected" value={formatValue(pace.projected, row.unitType)} />
          </dl>
        </>
      ) : (
        <p className="mt-4 flex items-center gap-1 border-t border-[var(--border)] pt-3 text-[12px] text-subtle">
          No goal set
          <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </p>
      )}
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-subtle">{label}</dt>
      <dd className="mt-0.5 truncate font-medium tnum">{value}</dd>
    </div>
  );
}
