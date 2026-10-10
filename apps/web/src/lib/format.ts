/**
 * Display formatting. Money arrives as integer cents and is formatted with
 * integer math only (CLAUDE.md rule 1): no division into floating dollars.
 */

export const BUSINESS_TIME_ZONE = "America/New_York";

/** 123456 -> "$1,234.56"; -500 -> "-$5.00". */
export function formatCents(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error(`Not whole cents: ${cents}`);
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const rest = abs % 100;
  const dollars = (abs - rest) / 100;
  return `${sign}$${groupThousands(dollars)}.${String(rest).padStart(2, "0")}`;
}

/** 1234567 -> "1,234,567" (whole numbers). */
export function groupThousands(n: number): string {
  const digits = String(Math.abs(Math.trunc(n)));
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return n < 0 ? `-${grouped}` : grouped;
}

/** A signed difference: "+3", "-1,200", "0". */
export function formatSigned(n: number, format: (n: number) => string = groupThousands): string {
  if (n > 0) return `+${format(n)}`;
  return format(n);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A calendar day 'YYYY-MM-DD' -> "Oct 9, 2026", with no time-zone shift. */
export function formatDate(day: string | null | undefined): string {
  if (!day) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return day;
  const [, y, m, d] = match;
  return `${MONTHS[Number(m) - 1] ?? m} ${Number(d)}, ${y}`;
}

const instantFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIME_ZONE,
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** An ISO instant -> "Oct 9, 2026, 2:03 PM" in business time. */
export function formatInstant(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : instantFormat.format(date);
}

/** "+12525550123" -> "(252) 555-0123"; anything else as is. */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const us = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(phone);
  return us ? `(${us[1]}) ${us[2]}-${us[3]}` : phone;
}

/** 1536 -> "1.5 KB" (file sizes). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  const kb = Math.round((bytes * 10) / 1024) / 10;
  if (kb < 1024) return `${kb} KB`;
  return `${Math.round((bytes * 10) / (1024 * 1024)) / 10} MB`;
}

/** "1 location", "3 locations". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${groupThousands(n)} ${n === 1 ? one : many}`;
}

/** Seconds -> "4 s", "2 min 5 s", "1 h 3 min". */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  if (s < 60) return `${s} s`;
  const minutes = Math.floor(s / 60);
  if (minutes < 60) return `${minutes} min ${s % 60} s`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}
