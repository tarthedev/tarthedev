import { assertLocalDate, BUSINESS_TIME_ZONE, isLocalDate, type LocalDate } from "@dwrg/core";

/**
 * Dates and times in ServiceTitan exports are business-local (America/New_York)
 * wall-clock values such as "10/6/2025" or "10/6/2025 8:15 AM". These helpers
 * turn them into business-local dates ('YYYY-MM-DD') and instants (Dates)
 * without depending on the machine's time zone.
 */

const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** "8:15 AM", "08:15:30 pm", "14:05", "14:05:09". */
const TIME = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?\s*([AaPp][Mm])?$/;
/** An instant with an explicit offset: "2025-10-06T12:15:00Z", "2025-10-06T08:15:00-04:00". */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

export interface LocalDateTime {
  date: LocalDate;
  hour: number;
  minute: number;
  second: number;
}

/** Splits "date[ T]time" into its parts; the time part may be missing. */
function splitDateTime(input: string): { datePart: string; timePart: string | null } {
  const text = input.trim();
  const isoT = /^(\d{4}-\d{2}-\d{2})T(.+)$/.exec(text);
  if (isoT?.[1] && isoT[2]) return { datePart: isoT[1], timePart: isoT[2] };
  const space = text.indexOf(" ");
  if (space < 0) return { datePart: text, timePart: null };
  return { datePart: text.slice(0, space), timePart: text.slice(space + 1).trim() };
}

function toLocalDate(datePart: string): LocalDate | null {
  let year: number;
  let month: number;
  let day: number;
  const us = US_DATE.exec(datePart);
  const iso = ISO_DATE.exec(datePart);
  if (us) {
    month = Number(us[1]);
    day = Number(us[2]);
    year = Number(us[3]);
  } else if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else {
    return null;
  }
  const value = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return isLocalDate(value) ? value : null;
}

function toTime(timePart: string): { hour: number; minute: number; second: number } | null {
  const match = TIME.exec(timePart);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = match[3] === undefined ? 0 : Number(match[3]);
  const meridiem = match[4]?.toUpperCase();
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === "AM" && hour === 12) hour = 0;
    if (meridiem === "PM" && hour !== 12) hour += 12;
  }
  if (hour > 23 || minute > 59 || second > 59) return null;
  return { hour, minute, second };
}

/**
 * A business-local calendar date from "M/D/YYYY" or "YYYY-MM-DD" (a time
 * after the date is allowed and ignored). Returns null when it isn't a real date.
 */
export function parseLocalDate(input: string): LocalDate | null {
  const text = input.trim();
  if (ISO_INSTANT.test(text)) return localDateTimeOf(new Date(text)).date;
  const { datePart, timePart } = splitDateTime(text);
  const date = toLocalDate(datePart);
  if (!date) return null;
  if (timePart !== null && toTime(timePart) === null) return null;
  return date;
}

/**
 * An instant from a business-local date-time ("10/6/2025 8:15 AM",
 * "2025-10-06 08:15:00"), a date alone (local midnight), or an ISO instant
 * with "Z" or an offset. Returns null when it can't be read.
 */
export function parseInstant(input: string): Date | null {
  const text = input.trim();
  if (ISO_INSTANT.test(text)) {
    const ms = Date.parse(text);
    return Number.isFinite(ms) ? new Date(ms) : null;
  }
  const { datePart, timePart } = splitDateTime(text);
  const date = toLocalDate(datePart);
  if (!date) return null;
  const time = timePart === null ? { hour: 0, minute: 0, second: 0 } : toTime(timePart);
  if (!time) return null;
  return zonedTimeToInstant({ date, ...time });
}

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** The business-local wall clock at an instant. */
export function localDateTimeOf(instant: Date): LocalDateTime {
  const parts: Record<string, number> = {};
  for (const part of partsFormatter.formatToParts(instant)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  const year = parts.year ?? 0;
  const month = parts.month ?? 1;
  const day = parts.day ?? 1;
  return {
    date: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    hour: parts.hour ?? 0,
    minute: parts.minute ?? 0,
    second: parts.second ?? 0,
  };
}

/** Offset of the business time zone from UTC at `ms`, in ms (New York in summer: -4h). */
function offsetAt(ms: number): number {
  const wall = localDateTimeOf(new Date(ms));
  const [y, m, d] = wall.date.split("-").map(Number) as [number, number, number];
  const wallAsUtc = Date.UTC(y, m - 1, d, wall.hour, wall.minute, wall.second);
  return wallAsUtc - Math.floor(ms / 1000) * 1000;
}

/**
 * The instant a business-local wall-clock time happens. In the autumn
 * fall-back hour the earlier (daylight time) instant is used; a time inside
 * the spring-forward gap moves forward by the gap.
 */
export function zonedTimeToInstant(local: LocalDateTime): Date {
  assertLocalDate(local.date, "date");
  const [y, m, d] = local.date.split("-").map(Number) as [number, number, number];
  const wallAsUtc = Date.UTC(y, m - 1, d, local.hour, local.minute, local.second);
  const first = wallAsUtc - offsetAt(wallAsUtc);
  const second = wallAsUtc - offsetAt(first);
  // Prefer the earlier of two valid readings (fall-back ambiguity).
  const valid = [first, second].filter((ms) => sameWallClock(ms, local));
  if (valid.length > 0) return new Date(Math.min(...valid));
  // In the spring-forward gap: `first` uses the standard-time offset, which
  // lands after the gap (2:30 AM becomes 3:30 AM daylight time).
  return new Date(first);
}

function sameWallClock(ms: number, local: LocalDateTime): boolean {
  const wall = localDateTimeOf(new Date(ms));
  return (
    wall.date === local.date &&
    wall.hour === local.hour &&
    wall.minute === local.minute &&
    wall.second === local.second
  );
}

/** "2025-10-06" -> "10/6/2025" (how ServiceTitan exports show dates). */
export function formatUsDate(date: LocalDate): string {
  assertLocalDate(date, "date");
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return `${m}/${d}/${y}`;
}

/** An instant as a business-local "10/6/2025 8:15 AM" ("8:15:30 AM" when seconds are set). */
export function formatUsDateTime(instant: Date): string {
  const wall = localDateTimeOf(instant);
  const hour12 = wall.hour % 12 === 0 ? 12 : wall.hour % 12;
  const meridiem = wall.hour < 12 ? "AM" : "PM";
  const seconds = wall.second === 0 ? "" : `:${String(wall.second).padStart(2, "0")}`;
  return `${formatUsDate(wall.date)} ${hour12}:${String(wall.minute).padStart(2, "0")}${seconds} ${meridiem}`;
}

/** Calendar year of a business-local date. */
export function yearOfLocalDate(date: LocalDate): number {
  return Number(date.slice(0, 4));
}

/** Calendar year of an instant in the business time zone. */
export function localYearOf(instant: Date): number {
  return yearOfLocalDate(localDateTimeOf(instant).date);
}
