import { describe, expect, it } from "vitest";
import {
  addDays,
  compareDateKeys,
  dateKeyInTz,
  diffDays,
  eachDate,
  endOfMonth,
  endOfWeek,
  formatRange,
  isDateKey,
  startOfMonth,
  startOfWeek,
  todayInTz,
  zonedDayStartUtc,
} from "@/lib/kpi/dates";

describe("date keys", () => {
  it("rejects impossible dates that Date would roll over", () => {
    expect(isDateKey("2026-08-21")).toBe(true);
    expect(isDateKey("2026-02-31")).toBe(false);
    expect(isDateKey("2026-13-01")).toBe(false);
    expect(isDateKey("21-08-2026")).toBe(false);
    expect(isDateKey("")).toBe(false);
  });

  it("accepts leap days only in leap years", () => {
    expect(isDateKey("2028-02-29")).toBe(true);
    expect(isDateKey("2026-02-29")).toBe(false);
  });

  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("measures whole days in both directions", () => {
    expect(diffDays("2026-08-17", "2026-08-23")).toBe(6);
    expect(diffDays("2026-08-23", "2026-08-17")).toBe(-6);
    expect(diffDays("2026-08-17", "2026-08-17")).toBe(0);
  });

  it("does not lose a day across a DST transition", () => {
    // US DST ends 2026-11-01. A week spanning it must still be seven days.
    const week = eachDate("2026-10-28", "2026-11-03");
    expect(week).toHaveLength(7);
    expect(week.at(-1)).toBe("2026-11-03");
  });
});

describe("period boundaries", () => {
  it("resolves Sunday-start weeks", () => {
    expect(startOfWeek("2026-08-21")).toBe("2026-08-16");
    expect(endOfWeek("2026-08-21")).toBe("2026-08-22");
  });

  it("resolves Monday-start weeks", () => {
    expect(startOfWeek("2026-08-21", 1)).toBe("2026-08-17");
    expect(endOfWeek("2026-08-21", 1)).toBe("2026-08-23");
  });

  it("handles a week start that lands on the anchor", () => {
    expect(startOfWeek("2026-08-16")).toBe("2026-08-16");
  });

  it("resolves month boundaries including February", () => {
    expect(startOfMonth("2026-08-21")).toBe("2026-08-01");
    expect(endOfMonth("2026-08-21")).toBe("2026-08-31");
    expect(endOfMonth("2026-02-10")).toBe("2026-02-28");
    expect(endOfMonth("2028-02-10")).toBe("2028-02-29");
    expect(endOfMonth("2026-12-01")).toBe("2026-12-31");
  });
});

describe("timezone handling", () => {
  it("reports the local calendar date, not the UTC one", () => {
    // 03:00 UTC on the 22nd is still the 21st in New York.
    const instant = new Date("2026-08-22T03:00:00.000Z");
    expect(dateKeyInTz(instant, "America/New_York")).toBe("2026-08-21");
    expect(dateKeyInTz(instant, "UTC")).toBe("2026-08-22");
  });

  it("converts a local day start to the right UTC instant", () => {
    // EDT is UTC-4 in August.
    expect(zonedDayStartUtc("2026-08-21", "America/New_York").toISOString()).toBe(
      "2026-08-21T04:00:00.000Z",
    );
    // EST is UTC-5 in January.
    expect(zonedDayStartUtc("2026-01-21", "America/New_York").toISOString()).toBe(
      "2026-01-21T05:00:00.000Z",
    );
  });

  it("returns a valid date key for today in any timezone", () => {
    for (const tz of ["America/New_York", "America/Los_Angeles", "UTC", "Pacific/Honolulu"]) {
      expect(isDateKey(todayInTz(tz))).toBe(true);
    }
  });
});

describe("helpers", () => {
  it("orders date keys", () => {
    expect(compareDateKeys("2026-08-01", "2026-08-02")).toBe(-1);
    expect(compareDateKeys("2026-08-02", "2026-08-01")).toBe(1);
    expect(compareDateKeys("2026-08-01", "2026-08-01")).toBe(0);
  });

  it("returns an empty range when end precedes start", () => {
    expect(eachDate("2026-08-10", "2026-08-01")).toEqual([]);
  });

  it("formats ranges without repeating the year", () => {
    expect(formatRange("2026-08-16", "2026-08-22")).toBe("Aug 16 – Aug 22");
    expect(formatRange("2026-08-16", "2026-08-16")).toBe("Aug 16");
    expect(formatRange("2026-12-28", "2027-01-03")).toBe("Dec 28, 2026 – Jan 3, 2027");
  });
});
