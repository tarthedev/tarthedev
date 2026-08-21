import { describe, expect, it } from "vitest";
import { buildWorkingCalendar, calendarFromDates, scheduledHours } from "@/lib/kpi/schedule";

describe("buildWorkingCalendar — calendar mode", () => {
  it("counts every day when nothing is recorded", () => {
    const calendar = buildWorkingCalendar([], "calendar");
    expect(calendar.countBetween("2026-08-17", "2026-08-23")).toBe(7);
    expect(calendar.unitLabel).toBe("day");
  });

  it("excludes days explicitly marked off", () => {
    const calendar = buildWorkingCalendar(
      [
        { date: "2026-08-19", kind: "OFF" },
        { date: "2026-08-20", kind: "PTO" },
        { date: "2026-08-21", kind: "HOLIDAY" },
      ],
      "calendar",
    );
    expect(calendar.countBetween("2026-08-17", "2026-08-23")).toBe(4);
    expect(calendar.isWorking("2026-08-19")).toBe(false);
    expect(calendar.isWorking("2026-08-18")).toBe(true);
  });
});

describe("buildWorkingCalendar — shift mode", () => {
  it("counts only days explicitly marked as work", () => {
    const calendar = buildWorkingCalendar(
      [
        { date: "2026-08-17", kind: "WORK" },
        { date: "2026-08-18", kind: "WORK" },
        { date: "2026-08-21", kind: "WORK" },
      ],
      "shifts",
    );
    expect(calendar.unitLabel).toBe("shift");
    expect(calendar.countBetween("2026-08-17", "2026-08-23")).toBe(3);
    expect(calendar.isWorking("2026-08-19")).toBe(false);
  });

  it("falls back to calendar mode when no shifts are recorded", () => {
    // Pacing over zero units would report every goal as unreachable.
    const calendar = buildWorkingCalendar([], "shifts");
    expect(calendar.mode).toBe("calendar");
    expect(calendar.unitLabel).toBe("day");
    expect(calendar.countBetween("2026-08-17", "2026-08-23")).toBe(7);
  });

  it("falls back when only non-working entries exist", () => {
    const calendar = buildWorkingCalendar([{ date: "2026-08-19", kind: "OFF" }], "shifts");
    expect(calendar.mode).toBe("calendar");
  });
});

describe("calendarFromDates", () => {
  it("round-trips a serialised calendar for the browser", () => {
    const source = buildWorkingCalendar(
      [
        { date: "2026-08-19", kind: "OFF" },
        { date: "2026-08-20", kind: "OFF" },
      ],
      "calendar",
    );
    const dates = source.datesBetween("2026-08-17", "2026-08-23");
    const rebuilt = calendarFromDates(dates, source.unitLabel);

    expect(rebuilt.countBetween("2026-08-17", "2026-08-23")).toBe(source.countBetween("2026-08-17", "2026-08-23"));
    expect(rebuilt.isWorking("2026-08-19")).toBe(false);
    expect(rebuilt.isWorking("2026-08-18")).toBe(true);
  });
});

describe("scheduledHours", () => {
  it("sums hours across working shifts only", () => {
    const shifts = [
      { date: "2026-08-17", kind: "WORK" as const, hours: 8 },
      { date: "2026-08-18", kind: "WORK" as const, hours: 6.5 },
      { date: "2026-08-19", kind: "OFF" as const, hours: null },
    ];
    expect(scheduledHours(shifts, "2026-08-17", "2026-08-23")).toBe(14.5);
  });

  it("returns null when no hours are recorded", () => {
    expect(scheduledHours([], "2026-08-17", "2026-08-23")).toBeNull();
    expect(
      scheduledHours([{ date: "2026-08-17", kind: "WORK", hours: null }], "2026-08-17", "2026-08-23"),
    ).toBeNull();
  });
});
