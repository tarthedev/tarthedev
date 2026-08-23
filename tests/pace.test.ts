import { describe, expect, it } from "vitest";
import { computePace, simulatePace, type PaceInput } from "@/lib/kpi/pace";
import { buildWorkingCalendar } from "@/lib/kpi/schedule";

const calendarDays = buildWorkingCalendar([], "calendar");

function base(overrides: Partial<PaceInput> = {}): PaceInput {
  return {
    current: 0,
    target: 10,
    periodStart: "2026-08-17",
    periodEnd: "2026-08-23",
    today: "2026-08-20",
    calendar: calendarDays,
    todayCounted: false,
    unitType: "COUNT",
    ...overrides,
  };
}

describe("computePace — worked examples from the spec", () => {
  it("Internet 7/12 with 3 selling days left needs 1.67/day", () => {
    // Week Mon 17th – Sun 23rd; today is Friday the 21st and still sellable,
    // so 21/22/23 remain.
    const result = computePace(base({ current: 7, target: 12, today: "2026-08-21" }));

    expect(result.remaining).toBe(5);
    expect(result.unitsRemaining).toBe(3);
    expect(result.requiredRate).toBeCloseTo(1.6667, 3);
    expect(result.nextUnitTarget).toBe(2); // ceil(1.67) — sell 2 today to stay on pace
    expect(result.attainmentPct).toBeCloseTo(58.33, 2);
  });

  it("11/20 at the end of day 5 of 10 projects to 22 (110%)", () => {
    const result = computePace(
      base({
        current: 11,
        target: 20,
        periodStart: "2026-08-01",
        periodEnd: "2026-08-10",
        today: "2026-08-05",
        todayCounted: true, // today's shift is done and included in `current`
      }),
    );

    expect(result.unitsEngaged).toBe(5);
    expect(result.unitsRemaining).toBe(5);
    expect(result.unitsTotal).toBe(10);
    expect(result.currentRate).toBe(2.2);
    expect(result.projected).toBe(22);
    expect(result.projectedAttainmentPct).toBe(110);
    expect(result.status).toBe("AHEAD");
  });

  it("Internet 8/12 reports 66.67% with 1.33 required per day", () => {
    const result = computePace(base({ current: 8, target: 12, today: "2026-08-21" }));

    expect(result.attainmentPct).toBeCloseTo(66.67, 2);
    expect(result.remaining).toBe(4);
    expect(result.unitsRemaining).toBe(3);
    expect(result.requiredRate).toBeCloseTo(1.3333, 3);
  });

  it("paces by remaining shifts, not days, when a schedule is recorded", () => {
    // 5 remaining, 4 scheduled shifts → 1.25 per shift.
    const shiftCalendar = buildWorkingCalendar(
      [
        { date: "2026-08-20", kind: "WORK" },
        { date: "2026-08-21", kind: "WORK" },
        { date: "2026-08-22", kind: "OFF" },
        { date: "2026-08-23", kind: "WORK" },
        { date: "2026-08-24", kind: "WORK" },
      ],
      "shifts",
    );

    const result = computePace(
      base({
        current: 7,
        target: 12,
        periodStart: "2026-08-17",
        periodEnd: "2026-08-24",
        today: "2026-08-20",
        calendar: shiftCalendar,
      }),
    );

    expect(result.unitLabel).toBe("shift");
    expect(result.unitsRemaining).toBe(4);
    expect(result.requiredRate).toBe(1.25);
  });
});

describe("computePace — status derivation", () => {
  const at = (current: number, today: string, todayCounted = true) =>
    computePace(base({ current, target: 10, periodStart: "2026-08-01", periodEnd: "2026-08-10", today, todayCounted }));

  it("reports COMPLETE once the target is reached", () => {
    expect(at(10, "2026-08-03").status).toBe("COMPLETE");
    expect(at(14, "2026-08-03").status).toBe("COMPLETE");
  });

  it("reports MISSED when the period is over and the goal was not met", () => {
    expect(at(6, "2026-08-10").status).toBe("MISSED");
    expect(at(6, "2026-08-15").status).toBe("MISSED");
  });

  it("grades ahead / on track / at risk / behind by pace index", () => {
    // Day 5 of 10 → an even pace would be 5.
    expect(at(7, "2026-08-05").status).toBe("AHEAD");
    expect(at(5, "2026-08-05").status).toBe("ON_TRACK");
    expect(at(4.6, "2026-08-05").status).toBe("AT_RISK");
    expect(at(2, "2026-08-05").status).toBe("BEHIND");
  });

  it("does not call an untouched period BEHIND on its first day", () => {
    const result = computePace(
      base({ current: 0, target: 10, periodStart: "2026-08-17", periodEnd: "2026-08-23", today: "2026-08-17" }),
    );
    expect(result.unitsEngaged).toBe(0);
    expect(result.status).toBe("ON_TRACK");
  });

  it("reports NO_GOAL when no target is set", () => {
    expect(computePace(base({ current: 4, target: 0 })).status).toBe("NO_GOAL");
  });
});

describe("computePace — edge cases", () => {
  it("never projects below what is already banked", () => {
    const result = computePace(
      base({ current: 9, target: 10, periodStart: "2026-08-01", periodEnd: "2026-08-31", today: "2026-08-02", todayCounted: true }),
    );
    expect(result.projected).toBeGreaterThanOrEqual(9);
  });

  it("returns a null required rate when no units remain", () => {
    const result = computePace(base({ current: 3, target: 10, today: "2026-08-30" }));
    expect(result.unitsRemaining).toBe(0);
    expect(result.requiredRate).toBeNull();
    expect(result.nextUnitTarget).toBeNull();
  });

  it("handles a period that has not started yet", () => {
    const result = computePace(
      base({ current: 0, target: 10, periodStart: "2026-09-01", periodEnd: "2026-09-30", today: "2026-08-21" }),
    );
    expect(result.unitsEngaged).toBe(0);
    expect(result.unitsRemaining).toBe(30);
    expect(result.currentRate).toBe(0);
  });

  it("produces finite numbers for a zero target", () => {
    const result = computePace(base({ current: 0, target: 0 }));
    for (const value of [result.attainmentPct, result.currentRate, result.projected, result.paceIndex]) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it("rounds fractional required rates for non-count units", () => {
    const result = computePace(base({ current: 100, target: 250, unitType: "CURRENCY", today: "2026-08-21" }));
    expect(result.nextUnitTarget).toBe(50); // 150 / 3 days
  });

  it("counts today as remaining until a snapshot for today is confirmed", () => {
    const open = computePace(base({ current: 5, target: 10, today: "2026-08-20", todayCounted: false }));
    const closed = computePace(base({ current: 5, target: 10, today: "2026-08-20", todayCounted: true }));

    expect(open.unitsRemaining).toBe(4); // 20, 21, 22, 23
    expect(closed.unitsRemaining).toBe(3); // 21, 22, 23
    expect(closed.unitsEngaged).toBe(open.unitsEngaged + 1);
  });
});

describe("simulatePace", () => {
  it("answers 'what if I sell one more'", () => {
    const input = base({ current: 8, target: 12, today: "2026-08-21", todayCounted: true });
    const now = computePace(input);
    const plusOne = simulatePace(input, 1);
    const plusTwo = simulatePace(input, 2);

    expect(now.current).toBe(8);
    expect(plusOne.current).toBe(9);
    expect(plusTwo.current).toBe(10);
    expect(plusOne.projected).toBeGreaterThan(now.projected);
    expect(plusOne.remaining).toBe(3);
  });

  it("never drives current below zero", () => {
    expect(simulatePace(base({ current: 1 }), -5).current).toBe(0);
  });
});
