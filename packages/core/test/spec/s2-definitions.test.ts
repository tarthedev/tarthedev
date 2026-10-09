/**
 * Spec tests for docs/02-commission-plan.md section 2 (definitions), written from the doc only.
 * Pay week, finished-week locking, sale/parts/labor/other costs, burdened cost, GP and paid in full.
 */
import { describe, expect, it } from "vitest";
import {
  BUSINESS_TIME_ZONE,
  burdenedRate,
  DEFAULT_BURDEN_BPS,
  type EffectiveDated,
  explainBurdenedRate,
  isPaidInFull,
  isWeekLocked,
  jobGrossProfit,
  laborCost,
  payWeekEnd,
  payWeekRange,
  payWeekStart,
  pickEffective,
  weekLocksAt,
} from "../../src/index";

const HOUR_MS = 3_600_000;

function hoursIn(weekStart: string): number {
  const range = payWeekRange(weekStart);
  return (Date.parse(range.endsBefore) - Date.parse(range.startsAt)) / HOUR_MS;
}

describe("Pay week: Monday 00:00 through Sunday 23:59, America/New_York", () => {
  it("the business time zone is New York", () => {
    expect(BUSINESS_TIME_ZONE).toBe("America/New_York");
  });

  it.each([
    ["2026-10-05", "2026-10-05"], // Monday starts its own week
    ["2026-10-08", "2026-10-05"],
    ["2026-10-11", "2026-10-05"], // Sunday is the last day of the week
    ["2026-10-12", "2026-10-12"],
    ["2027-01-01", "2026-12-28"], // weeks cross the year end
    ["2028-02-29", "2028-02-28"], // leap day
  ])("calendar date %s belongs to the week starting %s", (date, monday) => {
    expect(payWeekStart(date)).toBe(monday);
  });

  it("a week ends on Sunday", () => {
    expect(payWeekEnd("2026-10-05")).toBe("2026-10-11");
  });

  it.each([
    // Summer (EDT, UTC-4)
    ["2026-10-12T03:59:59Z", "2026-10-05"], // Sunday 23:59:59 local
    ["2026-10-12T04:00:00Z", "2026-10-12"], // Monday 00:00 local
    ["2026-10-11T23:59:00-04:00", "2026-10-05"],
    ["2026-10-12T00:00:00-04:00", "2026-10-12"],
    // Winter (EST, UTC-5)
    ["2026-12-14T04:59:59Z", "2026-12-07"],
    ["2026-12-14T05:00:00Z", "2026-12-14"],
    // A Monday morning in UTC is still Sunday night in New York
    ["2026-10-12T02:00:00Z", "2026-10-05"],
  ])("instant %s falls in the week starting %s", (instant, monday) => {
    expect(payWeekStart(instant)).toBe(monday);
  });

  it("accepts a Date as an instant", () => {
    expect(payWeekStart(new Date("2026-10-12T03:59:59Z"))).toBe("2026-10-05");
    expect(payWeekStart(new Date("2026-10-12T04:00:00Z"))).toBe("2026-10-12");
  });

  it("a normal week is exactly 168 hours, starting Monday 00:00 local", () => {
    const range = payWeekRange("2026-10-05");
    expect(range.weekStart).toBe("2026-10-05");
    expect(range.weekEnd).toBe("2026-10-11");
    expect(range.startsAt).toBe("2026-10-05T04:00:00.000Z");
    expect(range.endsBefore).toBe("2026-10-12T04:00:00.000Z");
    expect(hoursIn("2026-10-05")).toBe(168);
  });

  it("the spring-forward week (Sunday 2026-03-08) is 167 hours", () => {
    const range = payWeekRange("2026-03-02");
    expect(range.startsAt).toBe("2026-03-02T05:00:00.000Z");
    expect(range.endsBefore).toBe("2026-03-09T04:00:00.000Z");
    expect(hoursIn("2026-03-02")).toBe(167);
    // Sunday 23:59:59 EDT is still the old week; 00:30 EDT Monday is the new one.
    expect(payWeekStart("2026-03-09T03:59:59Z")).toBe("2026-03-02");
    expect(payWeekStart("2026-03-09T04:30:00Z")).toBe("2026-03-09");
  });

  it("the fall-back week (Sunday 2026-11-01) is 169 hours", () => {
    const range = payWeekRange("2026-10-26");
    expect(range.startsAt).toBe("2026-10-26T04:00:00.000Z");
    expect(range.endsBefore).toBe("2026-11-02T05:00:00.000Z");
    expect(hoursIn("2026-10-26")).toBe(169);
    // 04:30Z on Nov 2 is Sunday 23:30 EST, so it is still the old week.
    expect(payWeekStart("2026-11-02T04:30:00Z")).toBe("2026-10-26");
    expect(payWeekStart("2026-11-02T05:00:00Z")).toBe("2026-11-02");
  });

  it("refuses an instant without a zone, which would be ambiguous", () => {
    expect(() => payWeekStart("2026-10-12T00:00:00")).toThrow();
  });
});

describe("Week lock: the week's level and rate lock Sunday night", () => {
  it("locks at the end of Sunday 23:59 local, not before", () => {
    expect(weekLocksAt("2026-10-05")).toBe("2026-10-12T04:00:00.000Z");
    expect(isWeekLocked("2026-10-05", "2026-10-12T03:59:59Z")).toBe(false);
    expect(isWeekLocked("2026-10-05", "2026-10-12T04:00:00Z")).toBe(true);
    expect(isWeekLocked("2026-10-05", "2026-10-07T12:00:00Z")).toBe(false);
  });

  it("locks at the right instant in the fall-back week", () => {
    expect(weekLocksAt("2026-10-26")).toBe("2026-11-02T05:00:00.000Z");
    expect(isWeekLocked("2026-10-26", "2026-11-02T04:59:59Z")).toBe(false);
  });
});

describe("Labor: clocked time × burdened hourly cost = wage × 1.30", () => {
  it("defaults the burden to 130%", () => {
    expect(DEFAULT_BURDEN_BPS).toBe(13_000);
  });

  it("$21 wage → $27.30/hr burdened (the doc's example)", () => {
    expect(burdenedRate(2_100)).toBe(2_730);
    expect(explainBurdenedRate(2_100)).toContain("$27.30");
  });

  it("the burden can be overridden (per worker or by a later setting)", () => {
    expect(burdenedRate(2_100, 12_500)).toBe(2_625);
    expect(burdenedRate(2_000, 13_500)).toBe(2_700);
  });

  it("rounds the burdened rate half-up to the cent", () => {
    expect(burdenedRate(2_155)).toBe(2_802); // 2801.5
    expect(burdenedRate(2_150)).toBe(2_795);
    expect(burdenedRate(5)).toBe(7); // 6.5
    expect(burdenedRate(1)).toBe(1); // 1.3
  });

  it("labor is minutes × hourly cost, rounded half-up per line", () => {
    expect(laborCost(120, 2_700)).toBe(5_400);
    expect(laborCost(120, 2_730)).toBe(5_460);
    expect(laborCost(90, 2_700)).toBe(4_050);
    expect(laborCost(1, 2_730)).toBe(46); // 45.5
    expect(laborCost(1, 2_610)).toBe(44); // 43.5
    expect(laborCost(0, 2_730)).toBe(0);
  });

  it("the burden setting is effective-dated: a change never rewrites history", () => {
    type BurdenRow = EffectiveDated & { burdenBps: number };
    const rows: BurdenRow[] = [
      { effectiveFrom: "2026-01-01", burdenBps: 13_000 },
      { effectiveFrom: "2027-01-01", burdenBps: 13_500 },
    ];
    expect(pickEffective(rows, "2026-12-31")?.burdenBps).toBe(13_000);
    expect(pickEffective(rows, "2027-01-01")?.burdenBps).toBe(13_500);
    expect(pickEffective(rows, "2025-12-31")).toBeUndefined();
  });
});

describe("Gross profit = Sale − Parts and equipment − Labor − Other job costs", () => {
  it("includes every worker's labor, installers too, each at their own burdened cost", () => {
    const gp = jobGrossProfit({
      saleCents: 1_000_000,
      partsCents: 400_000,
      labor: [
        { workerId: "tech", minutes: 480, burdenedCentsPerHour: burdenedRate(2_100) },
        { workerId: "installer", minutes: 480, burdenedCentsPerHour: burdenedRate(1_800) },
      ],
      otherCostsCents: 15_000 + 5_000, // permit + disposal
    });
    expect(gp.laborCents).toBe(21_840 + 18_720);
    expect(gp.totalCostsCents).toBe(400_000 + 40_560 + 20_000);
    expect(gp.gpCents).toBe(539_440);
    expect(gp.laborByWorker).toEqual([
      { workerId: "tech", minutes: 480, laborCents: 21_840 },
      { workerId: "installer", minutes: 480, laborCents: 18_720 },
    ]);
  });

  it("can be negative", () => {
    const gp = jobGrossProfit({
      saleCents: 10_000,
      partsCents: 20_000,
      labor: [{ workerId: "tech", minutes: 60, burdenedCentsPerHour: 2_700 }],
      otherCostsCents: 0,
    });
    expect(gp.gpCents).toBe(-12_700);
  });

  it("sums labor lines that were each rounded (no rounding of the total)", () => {
    const gp = jobGrossProfit({
      saleCents: 10_000,
      partsCents: 0,
      labor: [
        { workerId: "a", minutes: 1, burdenedCentsPerHour: 2_730 }, // 45.5 → 46
        { workerId: "b", minutes: 1, burdenedCentsPerHour: 2_730 }, // 45.5 → 46
      ],
      otherCostsCents: 0,
    });
    expect(gp.laborCents).toBe(92);
    expect(gp.gpCents).toBe(9_908);
  });

  it("rejects fractional cents and minutes", () => {
    expect(() =>
      jobGrossProfit({ saleCents: 100.5, partsCents: 0, labor: [], otherCostsCents: 0 }),
    ).toThrow();
    expect(() => laborCost(1.5, 2_700)).toThrow();
  });
});

describe("Paid in full: balance is $0; financed jobs when GreenSky funds", () => {
  it.each([
    [[{ balanceCents: 0 }], true],
    [[{ balanceCents: 1 }], false],
    [[{ balanceCents: 0, awaitingFinancing: true }], false],
    [[{ balanceCents: 0, awaitingFinancing: false }], true],
    [[{ balanceCents: 0 }, { balanceCents: 2_500 }], false],
    [[{ balanceCents: 0 }, { balanceCents: 0 }], true],
  ])("%j → %s", (invoices, expected) => {
    expect(isPaidInFull(invoices)).toBe(expected);
  });
});
