import { describe, expect, it } from "vitest";
import {
  appendLog,
  clockTime,
  describeFix,
  describeGeoError,
  fixesPerMinute,
  type LogEntry,
  logText,
  MAX_LOG_ENTRIES,
} from "../src/features/gps/gpsLog";

const START = Date.parse("2026-10-09T14:00:00Z");
const s = (seconds: number) => START + seconds * 1000;

describe("fixesPerMinute", () => {
  it("counts fixes in each minute since Start, with empty minutes as 0", () => {
    const fixes = [s(1), s(2), s(59), s(61), s(185), s(190)];
    const { minutes, lastMinute } = fixesPerMinute(fixes, START, s(200));
    expect(minutes.map((m) => m.count)).toEqual([3, 1, 0, 2]);
    expect(minutes[2]).toEqual({ minute: 2, startsAt: s(120), count: 0 });
    // Within the last 60 s of t=200: 185 and 190.
    expect(lastMinute).toBe(2);
  });

  it("ignores fixes from before Start (a previous run)", () => {
    const { minutes, lastMinute } = fixesPerMinute([s(-5), s(10)], START, s(30));
    expect(minutes).toEqual([{ minute: 0, startsAt: START, count: 1 }]);
    expect(lastMinute).toBe(1);
  });

  it("has one empty minute right after Start", () => {
    expect(fixesPerMinute([], START, START)).toEqual({
      lastMinute: 0,
      minutes: [{ minute: 0, startsAt: START, count: 0 }],
    });
  });
});

describe("the log", () => {
  it("keeps the newest entries when it's full", () => {
    let log: LogEntry[] = [];
    for (let i = 0; i < MAX_LOG_ENTRIES + 3; i++) {
      log = appendLog(log, { at: i, kind: "fix", message: `fix ${i}` });
    }
    expect(log).toHaveLength(MAX_LOG_ENTRIES);
    expect(log[0]?.message).toBe("fix 3");
    expect(log.at(-1)?.message).toBe(`fix ${MAX_LOG_ENTRIES + 2}`);
  });

  it("writes times in business time with milliseconds", () => {
    expect(clockTime(Date.parse("2026-10-09T18:03:05.120Z"))).toBe("14:03:05.120");
  });

  it("describes fixes and errors in words", () => {
    expect(
      describeFix({ latitude: 35.5, longitude: -77.25, accuracy: 7.6, speed: 10, heading: 270.4 }),
    ).toBe("35.500000, -77.250000, ±8 m, 36 km/h, heading 270°");
    expect(
      describeFix({ latitude: 1, longitude: 2, accuracy: 30, speed: null, heading: null }),
    ).toBe("1.000000, 2.000000, ±30 m");
    expect(describeGeoError(1, "")).toBe("Location permission denied");
    expect(describeGeoError(3, "Timeout expired")).toBe(
      "Timed out waiting for a fix: Timeout expired",
    );
  });

  it("copies a header about the device, then every line", () => {
    const text = logText(
      [
        { at: s(0), kind: "start", message: "Start tapped" },
        { at: s(1), kind: "fix", message: "35.1, -77.1 ±5 m" },
      ],
      { standalone: true, permission: "Allowed", wakeLock: "On", userAgent: "iPad test" },
      s(2),
    );
    const lines = text.split("\n");
    expect(lines.slice(0, 7)).toEqual([
      "DWRG GPS test log",
      "Copied: 2026-10-09T14:00:02.000Z",
      "Home-screen app: yes",
      "Location permission: Allowed",
      "Screen wake lock: On",
      "Device: iPad test",
      "Entries: 2",
    ]);
    // Kind padded to 10 characters, two spaces either side.
    expect(lines[8]).toBe("10:00:00.000  start       Start tapped");
    expect(lines[9]).toContain("fix");
  });
});
