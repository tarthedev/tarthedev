/**
 * Calendar helpers for the demo generator. Business days are 'YYYY-MM-DD'
 * strings in America/New_York; instants are Dates. Nothing here reads the
 * clock or the process time zone, so output is the same on every machine.
 */

export const BUSINESS_TIME_ZONE = "America/New_York";

const MS_PER_DAY = 86_400_000;

function parseDay(day: string): [number, number, number] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) throw new Error(`Not a YYYY-MM-DD date: ${day}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function formatUtcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(day: string, days: number): string {
  const [y, m, d] = parseDay(day);
  return formatUtcDay(Date.UTC(y, m - 1, d) + days * MS_PER_DAY);
}

/** 0 = Sunday ... 6 = Saturday. */
export function dayOfWeek(day: string): number {
  const [y, m, d] = parseDay(day);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Month 1-12. */
export function monthOf(day: string): number {
  return parseDay(day)[1];
}

export function yearOf(day: string): number {
  return parseDay(day)[0];
}

/** Same month and day `years` later (Feb 29 becomes Feb 28). */
export function addYears(day: string, years: number): string {
  const [y, m, d] = parseDay(day);
  const target = y + years;
  const leap = (target % 4 === 0 && target % 100 !== 0) || target % 400 === 0;
  const dd = m === 2 && d === 29 && !leap ? 28 : d;
  return `${target}-${String(m).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

/** Whole days from `a` to `b`. */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = parseDay(a);
  const [by, bm, bd] = parseDay(b);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / MS_PER_DAY);
}

/** The Monday on or before `day` (pay weeks run Monday to Sunday). */
export function mondayOf(day: string): string {
  return addDays(day, -((dayOfWeek(day) + 6) % 7));
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

function zonedParts(ms: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of partsFormatter.formatToParts(new Date(ms))) {
    if (part.type !== "literal") out[part.type] = Number(part.value);
  }
  return out;
}

/** Offset of New York from UTC at instant `ms`, in ms (e.g. -4h in summer). */
function offsetAt(ms: number): number {
  const p = zonedParts(ms);
  const asUtc = Date.UTC(
    p.year ?? 0,
    (p.month ?? 1) - 1,
    p.day ?? 1,
    p.hour ?? 0,
    p.minute ?? 0,
    p.second ?? 0,
  );
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** The instant of local time `minutes` after midnight on business day `day`. */
export function localTime(day: string, minutes: number): Date {
  const [y, m, d] = parseDay(day);
  const guess = Date.UTC(y, m - 1, d) + Math.round(minutes * 60_000);
  const first = guess - offsetAt(guess);
  const second = guess - offsetAt(first);
  return new Date(second);
}

/** Business day (America/New_York) of an instant. */
export function localDay(instant: Date): string {
  const p = zonedParts(instant.getTime());
  const mm = String(p.month).padStart(2, "0");
  const dd = String(p.day).padStart(2, "0");
  return `${p.year}-${mm}-${dd}`;
}

export function addMinutes(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() + Math.round(minutes * 60_000));
}

export function minutesBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 60_000;
}
