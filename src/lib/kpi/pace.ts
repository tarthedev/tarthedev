import { type DateKey, addDays } from "@/lib/kpi/dates";
import type { WorkingCalendar } from "@/lib/kpi/schedule";

export type UnitType = "COUNT" | "CURRENCY" | "PERCENT" | "RATIO";

export type PaceStatus =
  | "COMPLETE" // goal already hit
  | "AHEAD"
  | "ON_TRACK"
  | "AT_RISK"
  | "BEHIND"
  | "MISSED" // period is over and the goal was not met
  | "NO_GOAL";

export interface PaceInput {
  /** Period-to-date production. */
  current: number;
  target: number;
  minimum?: number | null;
  stretch?: number | null;
  periodStart: DateKey;
  periodEnd: DateKey;
  /** Today's date in the user's timezone. */
  today: DateKey;
  calendar: WorkingCalendar;
  /**
   * True when today's production is already reflected in `current` — i.e. a
   * snapshot captured today has been confirmed. When false, today is still
   * sellable and is counted as a remaining unit.
   */
  todayCounted: boolean;
  unitType?: UnitType;
}

export interface TierProgress {
  value: number;
  remaining: number;
  attainmentPct: number;
  met: boolean;
}

export interface PaceResult {
  current: number;
  target: number;
  remaining: number;
  attainmentPct: number;

  unitLabel: "day" | "shift";
  /** Working units already worked and reflected in `current`. */
  unitsEngaged: number;
  /** Working units still available, including today when today is not counted. */
  unitsRemaining: number;
  unitsTotal: number;

  /** Production per worked unit so far. */
  currentRate: number;
  /** Production needed per remaining unit to reach target. Null when none remain. */
  requiredRate: number | null;
  /** What to produce on the next working unit to stay on pace. */
  nextUnitTarget: number | null;

  /** Straight-line finish at the current rate; never below what is already banked. */
  projected: number;
  projectedAttainmentPct: number;

  /** Where a perfectly even pace would have you right now. */
  expectedByNow: number;
  /** current ÷ expectedByNow. 1.0 is exactly on pace. */
  paceIndex: number;
  /** Units ahead (+) or behind (−) an even pace. */
  gapToPace: number;

  status: PaceStatus;
  tiers: {
    minimum: TierProgress | null;
    target: TierProgress;
    stretch: TierProgress | null;
  };
}

const round = (value: number, dp: number): number => {
  if (!Number.isFinite(value)) return 0;
  const f = 10 ** dp;
  return Math.round(value * f) / f;
};

/** Percentages are reported to 2dp; the UI decides how many to show. */
const pct = (numerator: number, denominator: number): number => {
  if (denominator === 0) return numerator > 0 ? 100 : 0;
  return round((numerator / denominator) * 100, 2);
};

function tier(current: number, value: number | null | undefined): TierProgress | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return {
    value,
    remaining: round(Math.max(0, value - current), 4),
    attainmentPct: pct(current, value),
    met: current >= value,
  };
}

/**
 * The pace engine. Pure, deterministic, and the single place any "am I on
 * track" number is produced — the AI layer never computes these.
 */
export function computePace(input: PaceInput): PaceResult {
  const { current, target, periodStart, periodEnd, today, calendar, todayCounted } = input;
  const unitType = input.unitType ?? "COUNT";

  // Window of units already worked. When today is not yet counted, the engaged
  // window stops at yesterday.
  const engagedEndRaw = todayCounted ? today : addDays(today, -1);
  const engagedEnd = engagedEndRaw > periodEnd ? periodEnd : engagedEndRaw;
  const unitsEngaged = engagedEnd < periodStart ? 0 : calendar.countBetween(periodStart, engagedEnd);

  // Window of units still available.
  const remainingStartRaw = todayCounted ? addDays(today, 1) : today;
  const remainingStart = remainingStartRaw < periodStart ? periodStart : remainingStartRaw;
  const unitsRemaining = remainingStart > periodEnd ? 0 : calendar.countBetween(remainingStart, periodEnd);

  const unitsTotal = unitsEngaged + unitsRemaining;

  const remaining = Math.max(0, target - current);
  const attainmentPct = pct(current, target);

  const currentRate = unitsEngaged > 0 ? round(current / unitsEngaged, 4) : 0;
  const requiredRate = unitsRemaining > 0 ? round(remaining / unitsRemaining, 4) : null;

  const nextUnitTarget =
    requiredRate === null
      ? null
      : unitType === "COUNT"
        ? Math.ceil(requiredRate)
        : round(requiredRate, 2);

  // Straight-line projection. Clamped at `current` because production banked
  // cannot be un-sold by a slow finish.
  const projectedRaw = unitsEngaged > 0 ? currentRate * unitsTotal : current;
  const projected = round(Math.max(current, projectedRaw), 2);

  const expectedByNow = unitsTotal > 0 ? round(target * (unitsEngaged / unitsTotal), 4) : target;
  const paceIndex =
    expectedByNow > 0 ? round(current / expectedByNow, 4) : current >= target && target > 0 ? 1 : 0;
  const gapToPace = round(current - expectedByNow, 4);

  const status = deriveStatus({
    current,
    target,
    unitsEngaged,
    unitsRemaining,
    paceIndex,
  });

  return {
    current: round(current, 4),
    target: round(target, 4),
    remaining: round(remaining, 4),
    attainmentPct,
    unitLabel: calendar.unitLabel,
    unitsEngaged,
    unitsRemaining,
    unitsTotal,
    currentRate,
    requiredRate,
    nextUnitTarget,
    projected,
    projectedAttainmentPct: pct(projected, target),
    expectedByNow,
    paceIndex,
    gapToPace,
    status,
    tiers: {
      minimum: tier(current, input.minimum),
      target: tier(current, target) as TierProgress,
      stretch: tier(current, input.stretch),
    },
  };
}

function deriveStatus(args: {
  current: number;
  target: number;
  unitsEngaged: number;
  unitsRemaining: number;
  paceIndex: number;
}): PaceStatus {
  const { current, target, unitsEngaged, unitsRemaining, paceIndex } = args;
  if (target <= 0) return "NO_GOAL";
  if (current >= target) return "COMPLETE";
  if (unitsRemaining === 0) return "MISSED";
  // Nothing has been worked yet — the period has not had a chance to go wrong.
  if (unitsEngaged === 0) return "ON_TRACK";
  if (paceIndex >= 1.05) return "AHEAD";
  if (paceIndex >= 0.98) return "ON_TRACK";
  if (paceIndex >= 0.85) return "AT_RISK";
  return "BEHIND";
}

/**
 * "If I sell one more" — re-runs the engine with `delta` added to current.
 * Used by the dashboard simulator to answer real-time decisions.
 */
export function simulatePace(input: PaceInput, delta: number): PaceResult {
  return computePace({ ...input, current: Math.max(0, input.current + delta) });
}

export const STATUS_ORDER: Record<PaceStatus, number> = {
  BEHIND: 0,
  MISSED: 1,
  AT_RISK: 2,
  ON_TRACK: 3,
  AHEAD: 4,
  COMPLETE: 5,
  NO_GOAL: 6,
};

export const STATUS_LABEL: Record<PaceStatus, string> = {
  COMPLETE: "Complete",
  AHEAD: "Ahead",
  ON_TRACK: "On Track",
  AT_RISK: "At Risk",
  BEHIND: "Behind",
  MISSED: "Missed",
  NO_GOAL: "No Goal",
};
