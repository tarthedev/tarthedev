import { describe, expect, it } from "vitest";
import {
  addDays,
  daysBetween,
  isLocalDate,
  isoWeekday,
  isWeekLocked,
  localDateOf,
  payWeekEnd,
  payWeekRange,
  payWeekStart,
  startOfLocalDay,
  weekLocksAt,
} from "../src/index";

describe("payWeekStart with local dates", () => {
  it.each([
    ["2026-03-02", "2026-03-02"], // Monday
    ["2026-03-08", "2026-03-02"], // Sunday ends the week
    ["2026-03-09", "2026-03-09"],
    ["2026-01-01", "2025-12-29"], // across the year boundary (Thursday)
    ["2024-02-29", "2024-02-26"], // leap day
  ])("%s → %s", (date, monday) => {
    expect(payWeekStart(date)).toBe(monday);
  });

  it("rejects impossible dates", () => {
    expect(() => payWeekStart("2026-02-30")).toThrow(RangeError);
    expect(() => payWeekStart("2026-13-01")).toThrow(RangeError);
    expect(isLocalDate("2026-02-29")).toBe(false);
    expect(isLocalDate("2024-02-29")).toBe(true);
  });
});

describe("payWeekStart with instants (America/New_York)", () => {
  it("uses the New York date, not the UTC date", () => {
    // Monday 02:00 UTC is still Sunday evening in New York.
    expect(payWeekStart("2026-03-09T02:00:00Z")).toBe("2026-03-02");
    expect(payWeekStart("2026-07-13T03:59:59Z")).toBe("2026-07-06");
    expect(payWeekStart("2026-07-13T04:00:00Z")).toBe("2026-07-13");
  });

  it("handles the spring-forward week (DST starts Sunday 2026-03-08)", () => {
    expect(payWeekStart("2026-03-08T06:59:59Z")).toBe("2026-03-02"); // 01:59:59 EST
    expect(payWeekStart("2026-03-08T07:00:00Z")).toBe("2026-03-02"); // 03:00:00 EDT
    expect(payWeekStart("2026-03-09T03:59:59Z")).toBe("2026-03-02"); // Sun 23:59:59 EDT
    expect(payWeekStart("2026-03-09T04:00:00Z")).toBe("2026-03-09"); // Mon 00:00 EDT
    // The same instant written with a local offset.
    expect(payWeekStart("2026-03-08T23:59:59-04:00")).toBe("2026-03-02");
  });

  it("handles the fall-back week (DST ends Sunday 2026-11-01)", () => {
    expect(payWeekStart("2026-11-01T05:30:00Z")).toBe("2026-10-26"); // 01:30 EDT
    expect(payWeekStart("2026-11-01T06:30:00Z")).toBe("2026-10-26"); // 01:30 EST (repeated hour)
    expect(payWeekStart("2026-11-02T04:59:59Z")).toBe("2026-10-26"); // Sun 23:59:59 EST
    expect(payWeekStart("2026-11-02T05:00:00Z")).toBe("2026-11-02"); // Mon 00:00 EST
    // 04:30 UTC Monday is still Sunday 23:30 EST after fall back.
    expect(payWeekStart("2026-11-02T04:30:00Z")).toBe("2026-10-26");
  });

  it("accepts Date objects", () => {
    expect(payWeekStart(new Date("2026-03-09T03:59:59Z"))).toBe("2026-03-02");
  });

  it("rejects instants without a zone and junk", () => {
    expect(() => payWeekStart("2026-03-09T03:00:00")).toThrow(RangeError);
    expect(() => payWeekStart("next tuesday")).toThrow(RangeError);
    expect(() => payWeekStart(new Date(Number.NaN))).toThrow(RangeError);
  });
});

describe("week ranges", () => {
  it("the spring-forward week is 167 hours long", () => {
    const range = payWeekRange("2026-03-02");
    expect(range).toEqual({
      weekStart: "2026-03-02",
      weekEnd: "2026-03-08",
      startsAt: "2026-03-02T05:00:00.000Z",
      endsBefore: "2026-03-09T04:00:00.000Z",
    });
    expect((Date.parse(range.endsBefore) - Date.parse(range.startsAt)) / 3_600_000).toBe(167);
  });

  it("the fall-back week is 169 hours long", () => {
    const range = payWeekRange("2026-10-26");
    expect(range.startsAt).toBe("2026-10-26T04:00:00.000Z");
    expect(range.endsBefore).toBe("2026-11-02T05:00:00.000Z");
    expect((Date.parse(range.endsBefore) - Date.parse(range.startsAt)) / 3_600_000).toBe(169);
  });

  it("weeks must start on Monday", () => {
    expect(() => payWeekRange("2026-03-03")).toThrow(RangeError);
    expect(payWeekEnd("2026-03-02")).toBe("2026-03-08");
  });

  it("locks at the end of Sunday night, local time", () => {
    expect(weekLocksAt("2026-03-02")).toBe("2026-03-09T04:00:00.000Z");
    expect(isWeekLocked("2026-03-02", "2026-03-09T03:59:59Z")).toBe(false);
    expect(isWeekLocked("2026-03-02", "2026-03-09T04:00:00Z")).toBe(true);
  });

  it("start of local day in other zones", () => {
    expect(startOfLocalDay("2026-07-01", "UTC")).toBe("2026-07-01T00:00:00.000Z");
    expect(startOfLocalDay("2026-07-01", "America/Los_Angeles")).toBe("2026-07-01T07:00:00.000Z");
  });
});

describe("date arithmetic", () => {
  it("adds days and counts between dates", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-03-02", "2026-04-01")).toBe(30);
    expect(daysBetween("2026-04-01", "2026-03-02")).toBe(-30);
    expect(isoWeekday("2026-03-08")).toBe(7);
    expect(isoWeekday("2026-03-09")).toBe(1);
  });

  it("localDateOf converts instants to New York dates", () => {
    expect(localDateOf("2026-01-01T04:59:59Z")).toBe("2025-12-31");
    expect(localDateOf("2026-01-01T05:00:00Z")).toBe("2026-01-01");
  });
});
