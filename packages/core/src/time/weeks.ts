/**
 * Pay weeks run Monday 00:00 through Sunday 23:59:59 in the business time zone
 * (America/New_York). Time is always passed in; nothing here reads the clock.
 * Uses Intl only (no date library).
 */

import { assertInt } from "../internal/int";

export const BUSINESS_TIME_ZONE = "America/New_York";

/** A calendar date with no time zone, "YYYY-MM-DD". */
export type LocalDate = string;

/** A point in time: an ISO 8601 string with "Z" or an offset, or a Date. */
export type Instant = string | Date;

const MS_PER_DAY = 86_400_000;
const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

type DateParts = { year: number; month: number; day: number };

function parseLocalDateParts(value: LocalDate, name = "date"): DateParts {
  const match = typeof value === "string" ? LOCAL_DATE_PATTERN.exec(value) : null;
  if (!match) {
    throw new RangeError(`${name} must be a date like 2026-03-09, got ${String(value)}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    throw new RangeError(`${name} is not a real calendar date: ${value}`);
  }
  return { year, month, day };
}

function formatDateParts({ year, month, day }: DateParts): LocalDate {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** True for a real calendar date written "YYYY-MM-DD". */
export function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== "string") return false;
  try {
    parseLocalDateParts(value);
    return true;
  } catch {
    return false;
  }
}

/** Throws unless `value` is a real "YYYY-MM-DD" date; returns it. */
export function assertLocalDate(value: LocalDate, name = "date"): LocalDate {
  parseLocalDateParts(value, name);
  return value;
}

function toEpochDay(date: LocalDate): number {
  const { year, month, day } = parseLocalDateParts(date);
  return Date.UTC(year, month - 1, day) / MS_PER_DAY;
}

function fromEpochDay(epochDay: number): LocalDate {
  const date = new Date(epochDay * MS_PER_DAY);
  return formatDateParts({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  });
}

/** Adds whole days to a calendar date. */
export function addDays(date: LocalDate, days: number): LocalDate {
  assertInt(days, "days");
  return fromEpochDay(toEpochDay(date) + days);
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: LocalDate, to: LocalDate): number {
  return toEpochDay(to) - toEpochDay(from);
}

/** ISO weekday of a calendar date: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: LocalDate): number {
  const { year, month, day } = parseLocalDateParts(date);
  const sundayZero = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return sundayZero === 0 ? 7 : sundayZero;
}

function toEpochMs(instant: Instant, name: string): number {
  let ms: number;
  if (instant instanceof Date) {
    ms = instant.getTime();
  } else if (typeof instant === "string" && INSTANT_PATTERN.test(instant)) {
    ms = Date.parse(instant);
  } else {
    throw new RangeError(
      `${name} must be an ISO instant with "Z" or an offset (like 2026-03-09T04:00:00Z), got ${String(instant)}`,
    );
  }
  if (!Number.isFinite(ms)) {
    throw new RangeError(`${name} is not a valid instant: ${String(instant)}`);
  }
  return ms;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

type WallClock = DateParts & { hour: number; minute: number; second: number };

function wallClockAt(epochMs: number, timeZone: string): WallClock {
  const values: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(epochMs)) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  const read = (key: string): number => {
    const value = values[key];
    if (value === undefined || !Number.isInteger(value)) {
      throw new RangeError(`Could not read ${key} for time zone ${timeZone}`);
    }
    return value;
  };
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

/** The calendar date an instant falls on in `timeZone` (default: the business time zone). */
export function localDateOf(instant: Instant, timeZone: string = BUSINESS_TIME_ZONE): LocalDate {
  return formatDateParts(wallClockAt(toEpochMs(instant, "instant"), timeZone));
}

/** Offset of `timeZone` from UTC at an instant, in milliseconds (New York in summer: -4h). */
function offsetMsAt(epochMs: number, timeZone: string): number {
  const wholeSecond = Math.floor(epochMs / 1000) * 1000;
  const wall = wallClockAt(wholeSecond, timeZone);
  const wallAsUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );
  return wallAsUtc - wholeSecond;
}

/**
 * The instant local midnight starts `date` in `timeZone`, as an ISO string in UTC.
 * Midnight never falls in a US DST gap (changes happen at 2 a.m.), so this is unambiguous there.
 */
export function startOfLocalDay(date: LocalDate, timeZone: string = BUSINESS_TIME_ZONE): string {
  const guess = toEpochDay(date) * MS_PER_DAY;
  const firstOffset = offsetMsAt(guess, timeZone);
  let instant = guess - firstOffset;
  const secondOffset = offsetMsAt(instant, timeZone);
  if (secondOffset !== firstOffset) {
    instant = guess - secondOffset;
  }
  return new Date(instant).toISOString();
}

/**
 * The Monday (YYYY-MM-DD) that starts the pay week containing `value`.
 * `value` is either a local calendar date ("2026-03-08") or an instant
 * ("2026-03-09T03:30:00Z" or a Date), which is first converted to the business time zone.
 * Pass calendar dates (such as a SQL `date` column) as "YYYY-MM-DD" strings: a Date is always
 * treated as an instant, so a date read back as UTC midnight would land on the previous day.
 */
export function payWeekStart(
  value: LocalDate | Instant,
  timeZone: string = BUSINESS_TIME_ZONE,
): LocalDate {
  const date =
    typeof value === "string" && LOCAL_DATE_PATTERN.test(value)
      ? assertLocalDate(value)
      : localDateOf(value, timeZone);
  return addDays(date, 1 - isoWeekday(date));
}

/** Throws unless `weekStart` is a Monday; returns it. */
export function assertWeekStart(weekStart: LocalDate, name = "weekStart"): LocalDate {
  assertLocalDate(weekStart, name);
  if (isoWeekday(weekStart) !== 1) {
    throw new RangeError(`${name} must be a Monday, got ${weekStart}`);
  }
  return weekStart;
}

/** The Sunday that ends the pay week starting `weekStart`. */
export function payWeekEnd(weekStart: LocalDate): LocalDate {
  return addDays(assertWeekStart(weekStart), 6);
}

export type PayWeekRange = {
  weekStart: LocalDate;
  weekEnd: LocalDate;
  /** First instant of the week (Monday 00:00 local), ISO in UTC. */
  startsAt: string;
  /** First instant after the week (next Monday 00:00 local), ISO in UTC. Use `< endsBefore`. */
  endsBefore: string;
};

/** The pay week's dates and its half-open instant range [startsAt, endsBefore). */
export function payWeekRange(
  weekStart: LocalDate,
  timeZone: string = BUSINESS_TIME_ZONE,
): PayWeekRange {
  assertWeekStart(weekStart);
  return {
    weekStart,
    weekEnd: addDays(weekStart, 6),
    startsAt: startOfLocalDay(weekStart, timeZone),
    endsBefore: startOfLocalDay(addDays(weekStart, 7), timeZone),
  };
}

/** When a pay week locks: the end of Sunday night (next Monday 00:00 local), ISO in UTC. */
export function weekLocksAt(weekStart: LocalDate, timeZone: string = BUSINESS_TIME_ZONE): string {
  return payWeekRange(weekStart, timeZone).endsBefore;
}

/** True once `now` has reached the end of the pay week's Sunday night. */
export function isWeekLocked(
  weekStart: LocalDate,
  now: Instant,
  timeZone: string = BUSINESS_TIME_ZONE,
): boolean {
  return toEpochMs(now, "now") >= Date.parse(weekLocksAt(weekStart, timeZone));
}

/** Compares two pay weeks (or any two local dates): negative, zero or positive. */
export function compareLocalDates(a: LocalDate, b: LocalDate): number {
  return daysBetween(b, a);
}
