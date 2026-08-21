import {
  type DateKey,
  addDays,
  endOfMonth,
  endOfWeek,
  formatRange,
  startOfMonth,
  startOfWeek,
} from "@/lib/kpi/dates";

export type PeriodType = "DAILY" | "WEEKLY" | "MONTHLY" | "CUSTOM";

export interface Period {
  type: PeriodType;
  start: DateKey;
  end: DateKey;
  label: string;
}

export interface PeriodOptions {
  /** 0 = Sunday. Victra weeks commonly start Sunday, which is the default. */
  weekStartsOn?: number;
}

/** The period of the given `type` that contains `anchor`. */
export function resolvePeriod(type: PeriodType, anchor: DateKey, options: PeriodOptions = {}): Period {
  const weekStartsOn = options.weekStartsOn ?? 0;
  switch (type) {
    case "DAILY":
      return { type, start: anchor, end: anchor, label: formatRange(anchor, anchor) };
    case "WEEKLY": {
      const start = startOfWeek(anchor, weekStartsOn);
      const end = endOfWeek(anchor, weekStartsOn);
      return { type, start, end, label: formatRange(start, end) };
    }
    case "MONTHLY": {
      const start = startOfMonth(anchor);
      const end = endOfMonth(anchor);
      return { type, start, end, label: formatRange(start, end) };
    }
    case "CUSTOM":
      return { type, start: anchor, end: anchor, label: formatRange(anchor, anchor) };
  }
}

export function customPeriod(start: DateKey, end: DateKey): Period {
  return { type: "CUSTOM", start, end, label: formatRange(start, end) };
}

/** The same period shifted back by one full cycle, for period-over-period comparison. */
export function previousPeriod(period: Period, options: PeriodOptions = {}): Period {
  switch (period.type) {
    case "DAILY":
      return resolvePeriod("DAILY", addDays(period.start, -1), options);
    case "WEEKLY":
      return resolvePeriod("WEEKLY", addDays(period.start, -7), options);
    case "MONTHLY":
      return resolvePeriod("MONTHLY", addDays(period.start, -1), options);
    case "CUSTOM": {
      const span = Math.max(1, Math.round((Date.parse(period.end) - Date.parse(period.start)) / 86_400_000) + 1);
      return customPeriod(addDays(period.start, -span), addDays(period.end, -span));
    }
  }
}

export function periodContains(period: Period, key: DateKey): boolean {
  return key >= period.start && key <= period.end;
}
