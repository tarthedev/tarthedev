/**
 * Pure helpers for the GPS test page (docs/04, month 1: test one iPad):
 * the event log, counting fixes per minute, and the text that "Copy log"
 * puts on the clipboard. Nothing here touches the network.
 */

export type LogKind =
  | "app"
  | "start"
  | "stop"
  | "fix"
  | "error"
  | "visibility"
  | "permission"
  | "wake-lock"
  | "page"
  | "network";

export interface LogEntry {
  /** Epoch milliseconds. */
  at: number;
  kind: LogKind;
  message: string;
}

/** The most entries kept (oldest dropped first). */
export const MAX_LOG_ENTRIES = 5000;

export function appendLog(log: readonly LogEntry[], entry: LogEntry): LogEntry[] {
  const next = [...log, entry];
  return next.length > MAX_LOG_ENTRIES ? next.slice(next.length - MAX_LOG_ENTRIES) : next;
}

const timeFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/** "14:03:05.120" in business time. */
export function clockTime(at: number): string {
  const ms = String(Math.abs(at % 1000)).padStart(3, "0");
  return `${timeFormat.format(new Date(at))}.${ms}`;
}

export function formatLogLine(entry: LogEntry): string {
  return `${clockTime(entry.at)}  ${entry.kind.padEnd(10)}  ${entry.message}`;
}

export interface FixLike {
  latitude: number;
  longitude: number;
  accuracy: number;
  speed: number | null;
  heading: number | null;
}

/** "35.123456, -76.123456 ±8 m, 12 km/h, heading 270°" */
export function describeFix(fix: FixLike): string {
  const parts = [
    `${fix.latitude.toFixed(6)}, ${fix.longitude.toFixed(6)}`,
    `±${Math.round(fix.accuracy)} m`,
  ];
  if (fix.speed !== null && Number.isFinite(fix.speed)) {
    parts.push(`${Math.round(fix.speed * 3.6)} km/h`);
  }
  if (fix.heading !== null && Number.isFinite(fix.heading)) {
    parts.push(`heading ${Math.round(fix.heading)}°`);
  }
  return parts.join(", ");
}

/** Plain words for a GeolocationPositionError code. */
export function describeGeoError(code: number, message: string): string {
  const what =
    code === 1
      ? "Location permission denied"
      : code === 2
        ? "Position unavailable (no GPS signal?)"
        : code === 3
          ? "Timed out waiting for a fix"
          : "Location error";
  return message ? `${what}: ${message}` : what;
}

export interface MinuteCount {
  /** Minutes since Start (0 = the first minute). */
  minute: number;
  /** Epoch ms when that minute began. */
  startsAt: number;
  count: number;
}

/**
 * Fixes per minute since `startedAt`, every minute up to `now` included
 * (minutes with no fix count 0, which is what a gap looks like), plus how
 * many fixes arrived in the last 60 seconds.
 */
export function fixesPerMinute(
  fixTimes: readonly number[],
  startedAt: number,
  now: number,
): { lastMinute: number; minutes: MinuteCount[] } {
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 60_000));
  const minutes: MinuteCount[] = Array.from({ length: elapsed + 1 }, (_, minute) => ({
    minute,
    startsAt: startedAt + minute * 60_000,
    count: 0,
  }));
  let lastMinute = 0;
  for (const at of fixTimes) {
    if (at < startedAt || at > now) continue;
    const bucket = minutes[Math.floor((at - startedAt) / 60_000)];
    if (bucket) bucket.count++;
    if (now - at < 60_000) lastMinute++;
  }
  return { lastMinute, minutes };
}

export interface Environment {
  standalone: boolean;
  permission: string;
  wakeLock: string;
  userAgent: string;
}

/** What "Copy log" copies: a header about the device, then every line. */
export function logText(entries: readonly LogEntry[], env: Environment, now: number): string {
  return [
    "DWRG GPS test log",
    `Copied: ${new Date(now).toISOString()}`,
    `Home-screen app: ${env.standalone ? "yes" : "no"}`,
    `Location permission: ${env.permission}`,
    `Screen wake lock: ${env.wakeLock}`,
    `Device: ${env.userAgent}`,
    `Entries: ${entries.length}`,
    "",
    ...entries.map(formatLogLine),
    "",
  ].join("\n");
}
