import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";

/**
 * Calendar dates are handled as plain `YYYY-MM-DD` strings ("date keys")
 * everywhere in the domain layer, and converted to `Date` only at the database
 * boundary. Arithmetic runs in UTC, which has no DST, so a period never gains
 * or loses a day when the clocks change.
 */
export type DateKey = string;

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function isDateKey(value: unknown): value is DateKey {
  if (typeof value !== "string" || !DATE_KEY.test(value)) return false;
  const d = dateKeyToUtc(value);
  // "2026-13-01" parses to an Invalid Date, whose toISOString() throws.
  if (Number.isNaN(d.getTime())) return false;
  // Rejects 2026-02-31 and friends, which Date happily rolls over.
  return utcToDateKey(d) === value;
}

export function assertDateKey(value: string): DateKey {
  if (!isDateKey(value)) throw new Error(`Invalid date key: ${value}`);
  return value;
}

/** Midnight UTC for a date key — the representation Postgres `date` columns use. */
export function dateKeyToUtc(key: DateKey): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

export function utcToDateKey(date: Date): DateKey {
  return date.toISOString().slice(0, 10);
}

/** The current calendar date in the user's timezone. */
export function todayInTz(timeZone: string, now: Date = new Date()): DateKey {
  return formatInTimeZone(now, timeZone, "yyyy-MM-dd");
}

/** The calendar date an instant falls on, in the user's timezone. */
export function dateKeyInTz(instant: Date, timeZone: string): DateKey {
  return formatInTimeZone(instant, timeZone, "yyyy-MM-dd");
}

export function addDays(key: DateKey, days: number): DateKey {
  const d = dateKeyToUtc(key);
  d.setUTCDate(d.getUTCDate() + days);
  return utcToDateKey(d);
}

/** Whole days from `a` to `b`; negative when `b` precedes `a`. */
export function diffDays(a: DateKey, b: DateKey): number {
  const ms = dateKeyToUtc(b).getTime() - dateKeyToUtc(a).getTime();
  return Math.round(ms / 86_400_000);
}

export function compareDateKeys(a: DateKey, b: DateKey): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function clampDateKey(key: DateKey, min: DateKey, max: DateKey): DateKey {
  if (key < min) return min;
  if (key > max) return max;
  return key;
}

export function isWithin(key: DateKey, start: DateKey, end: DateKey): boolean {
  return key >= start && key <= end;
}

/** Every date from `start` to `end`, inclusive. Empty when end precedes start. */
export function eachDate(start: DateKey, end: DateKey): DateKey[] {
  const out: DateKey[] = [];
  if (end < start) return out;
  let cursor = start;
  while (cursor <= end) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(key: DateKey): number {
  return dateKeyToUtc(key).getUTCDay();
}

export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** `weekStartsOn` follows the same 0=Sunday convention. */
export function startOfWeek(key: DateKey, weekStartsOn = 0): DateKey {
  const delta = (dayOfWeek(key) - weekStartsOn + 7) % 7;
  return addDays(key, -delta);
}

export function endOfWeek(key: DateKey, weekStartsOn = 0): DateKey {
  return addDays(startOfWeek(key, weekStartsOn), 6);
}

export function startOfMonth(key: DateKey): DateKey {
  return `${key.slice(0, 7)}-01`;
}

export function endOfMonth(key: DateKey): DateKey {
  const d = dateKeyToUtc(startOfMonth(key));
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return utcToDateKey(d);
}

/** Human-facing range label, e.g. "Aug 17 – Aug 23". */
export function formatRange(start: DateKey, end: DateKey): string {
  const fmt = (k: DateKey) =>
    formatInTimeZone(dateKeyToUtc(k), "UTC", start.slice(0, 4) === end.slice(0, 4) ? "MMM d" : "MMM d, yyyy");
  return start === end ? fmt(start) : `${fmt(start)} – ${fmt(end)}`;
}

export function formatDateKey(key: DateKey, pattern = "MMM d, yyyy"): string {
  return formatInTimeZone(dateKeyToUtc(key), "UTC", pattern);
}

/** Renders a stored UTC timestamp in the user's timezone. */
export function formatInstant(instant: Date, timeZone: string, pattern = "MMM d, yyyy h:mm a"): string {
  return formatInTimeZone(instant, timeZone, pattern);
}

/** Local wall-clock hour in the user's timezone — used for the greeting. */
export function hourInTz(timeZone: string, now: Date = new Date()): number {
  return toZonedTime(now, timeZone).getHours();
}

/** The UTC instant at which a calendar day begins in the given timezone. */
export function zonedDayStartUtc(key: DateKey, timeZone: string): Date {
  return fromZonedTime(`${key}T00:00:00`, timeZone);
}

/** The UTC instant just after a calendar day ends in the given timezone. */
export function zonedDayEndUtc(key: DateKey, timeZone: string): Date {
  return zonedDayStartUtc(addDays(key, 1), timeZone);
}
