import { cn } from "@/lib/cn";
import type { PaceStatus } from "@/lib/kpi/pace";

const FILL: Record<PaceStatus, string> = {
  COMPLETE: "bg-[var(--positive)]",
  AHEAD: "bg-[var(--positive)]",
  ON_TRACK: "bg-[var(--positive)]",
  AT_RISK: "bg-[var(--warning)]",
  BEHIND: "bg-[var(--negative)]",
  MISSED: "bg-[var(--negative)]",
  NO_GOAL: "bg-[var(--neutral)]",
};

/**
 * Attainment bar with an optional pace marker: the thin line shows where an
 * even pace would have you right now, which turns the bar from decoration into
 * a comparison.
 */
export function ProgressBar({
  value,
  status = "ON_TRACK",
  paceMarkerPct,
  label,
  className,
}: {
  value: number;
  status?: PaceStatus;
  paceMarkerPct?: number | null;
  label?: string;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  const marker = paceMarkerPct === null || paceMarkerPct === undefined ? null : Math.max(0, Math.min(100, paceMarkerPct));

  return (
    <div
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-[var(--surface-sunken)]", className)}
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? "Goal attainment"}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-500", FILL[status])}
        style={{ width: `${clamped}%` }}
      />
      {marker !== null && marker > 0 && marker < 100 && (
        <span
          aria-hidden="true"
          title="Even pace"
          className="absolute top-0 h-full w-px bg-[var(--text)] opacity-40"
          style={{ left: `${marker}%` }}
        />
      )}
    </div>
  );
}

/** Compact tiered bar showing minimum / target / stretch on one track. */
export function TieredProgress({
  current,
  minimum,
  target,
  stretch,
  status,
}: {
  current: number;
  minimum: number | null;
  target: number;
  stretch: number | null;
  status: PaceStatus;
}) {
  const ceiling = Math.max(stretch ?? target, target, current) || 1;
  const pct = (value: number) => Math.max(0, Math.min(100, (value / ceiling) * 100));

  return (
    <div className="relative h-2 w-full overflow-hidden rounded-full bg-[var(--surface-sunken)]">
      <div className={cn("h-full rounded-full", FILL[status])} style={{ width: `${pct(current)}%` }} />
      {minimum !== null && (
        <span
          aria-hidden="true"
          className="absolute top-0 h-full w-px bg-[var(--text-subtle)]"
          style={{ left: `${pct(minimum)}%` }}
        />
      )}
      <span
        aria-hidden="true"
        className="absolute top-0 h-full w-px bg-[var(--text)] opacity-60"
        style={{ left: `${pct(target)}%` }}
      />
    </div>
  );
}
