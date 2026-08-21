import { type DateKey, eachDate } from "@/lib/kpi/dates";

export type ShiftKind = "WORK" | "OFF" | "PTO" | "HOLIDAY";

export interface ShiftEntry {
  date: DateKey;
  kind: ShiftKind;
  hours?: number | null;
}

/**
 * How a recorded schedule is interpreted.
 *
 * `calendar` — every date counts unless it is explicitly marked OFF/PTO/HOLIDAY.
 *   Best when you only bother to record time off.
 * `shifts`   — only dates explicitly marked WORK count. Best when you enter your
 *   published schedule. Pacing then reads "per remaining shift", which is far
 *   more actionable than "per remaining day".
 */
export type ScheduleMode = "calendar" | "shifts";

export interface WorkingCalendar {
  mode: ScheduleMode;
  unitLabel: "day" | "shift";
  isWorking(date: DateKey): boolean;
  /** Working units in `[start, end]`, inclusive. Zero when the range is empty. */
  countBetween(start: DateKey, end: DateKey): number;
  /** Working dates in `[start, end]`, inclusive. */
  datesBetween(start: DateKey, end: DateKey): DateKey[];
}

const NON_WORKING: ReadonlySet<ShiftKind> = new Set<ShiftKind>(["OFF", "PTO", "HOLIDAY"]);

/**
 * Builds the working-unit calendar used by the pace engine.
 *
 * In `shifts` mode with no recorded shifts we fall back to `calendar` — pacing
 * over zero units would divide by zero and report every goal as unreachable.
 */
export function buildWorkingCalendar(shifts: ShiftEntry[], mode: ScheduleMode = "calendar"): WorkingCalendar {
  const byDate = new Map<DateKey, ShiftEntry>();
  for (const shift of shifts) byDate.set(shift.date, shift);

  const hasWorkEntries = shifts.some((s) => s.kind === "WORK");
  const effectiveMode: ScheduleMode = mode === "shifts" && !hasWorkEntries ? "calendar" : mode;

  const isWorking = (date: DateKey): boolean => {
    const entry = byDate.get(date);
    if (effectiveMode === "shifts") return entry?.kind === "WORK";
    if (!entry) return true;
    return !NON_WORKING.has(entry.kind);
  };

  const datesBetween = (start: DateKey, end: DateKey): DateKey[] =>
    eachDate(start, end).filter(isWorking);

  return {
    mode: effectiveMode,
    unitLabel: effectiveMode === "shifts" ? "shift" : "day",
    isWorking,
    datesBetween,
    countBetween: (start, end) => datesBetween(start, end).length,
  };
}

/** Total scheduled hours across `[start, end]`, or null when none are recorded. */
export function scheduledHours(shifts: ShiftEntry[], start: DateKey, end: DateKey): number | null {
  const relevant = shifts.filter(
    (s) => s.date >= start && s.date <= end && s.kind === "WORK" && typeof s.hours === "number",
  );
  if (relevant.length === 0) return null;
  return relevant.reduce((sum, s) => sum + (s.hours ?? 0), 0);
}

/**
 * Rebuilds a calendar from an explicit list of working dates.
 *
 * Used to ship the working calendar to the browser: a `WorkingCalendar` carries
 * methods and cannot cross the server/client boundary, but the dates it was
 * built from can.
 */
export function calendarFromDates(
  workingDates: DateKey[],
  unitLabel: "day" | "shift" = "day",
): WorkingCalendar {
  const set = new Set(workingDates);
  const isWorking = (date: DateKey) => set.has(date);
  const datesBetween = (start: DateKey, end: DateKey) => eachDate(start, end).filter(isWorking);

  return {
    mode: unitLabel === "shift" ? "shifts" : "calendar",
    unitLabel,
    isWorking,
    datesBetween,
    countBetween: (start, end) => datesBetween(start, end).length,
  };
}
