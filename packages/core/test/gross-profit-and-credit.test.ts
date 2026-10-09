import { describe, expect, it } from "vitest";
import {
  burdenedRate,
  creditGrossProfit,
  creditJob,
  DEFAULT_BURDEN_BPS,
  explainBurdenedRate,
  jobGrossProfit,
  laborCost,
} from "../src/index";

describe("burdenedRate", () => {
  it("defaults to wage × 1.30", () => {
    expect(DEFAULT_BURDEN_BPS).toBe(13_000);
    expect(burdenedRate(2_100)).toBe(2_730);
    expect(burdenedRate(2_100, 12_500)).toBe(2_625);
    expect(burdenedRate(1_555)).toBe(2_022); // 2021.5 → 2022
    expect(explainBurdenedRate(2_100)).toBe("$21.00/hr wage × 130% = $27.30/hr burdened cost");
  });
  it("rejects negative or fractional inputs", () => {
    expect(() => burdenedRate(-1)).toThrow(RangeError);
    expect(() => burdenedRate(2_100.5)).toThrow(RangeError);
  });
});

describe("laborCost", () => {
  it("rounds each line half-up", () => {
    expect(laborCost(120, 2_700)).toBe(5_400);
    expect(laborCost(1, 2_730)).toBe(46); // 45.5 → 46
    expect(laborCost(1, 2_700)).toBe(45);
    expect(laborCost(0, 2_700)).toBe(0);
  });
});

describe("jobGrossProfit", () => {
  it("breaks labor down per worker, summing repeated entries", () => {
    const result = jobGrossProfit({
      saleCents: 500_000,
      partsCents: 200_000,
      otherCostsCents: 10_000,
      labor: [
        { workerId: "tech-a", workerName: "Ann", minutes: 90, burdenedCentsPerHour: 2_730 },
        { workerId: "installer-1", minutes: 480, burdenedCentsPerHour: 2_340 },
        { workerId: "tech-a", workerName: "Ann", minutes: 1, burdenedCentsPerHour: 2_730 },
      ],
    });
    expect(result.laborByWorker).toEqual([
      { workerId: "tech-a", minutes: 91, laborCents: 4_095 + 46 },
      { workerId: "installer-1", minutes: 480, laborCents: 18_720 },
    ]);
    expect(result.laborCents).toBe(4_095 + 46 + 18_720);
    expect(result.gpCents).toBe(500_000 - 200_000 - 10_000 - result.laborCents);
    expect(result.explanation).toContain(
      "Ann: 1h 30m × $27.30/hr = $40.95 + 1m × $27.30/hr = $0.46",
    );
  });

  it("allows negative gross profit", () => {
    const result = jobGrossProfit({
      saleCents: 10_000,
      partsCents: 15_000,
      otherCostsCents: 0,
      labor: [{ workerId: "tech-a", minutes: 60, burdenedCentsPerHour: 2_700 }],
    });
    expect(result.gpCents).toBe(-7_700);
    expect(result.explanation).toContain("gross profit -$77.00");
  });

  it("handles a job with no labor", () => {
    const result = jobGrossProfit({
      saleCents: 1_000,
      partsCents: 0,
      otherCostsCents: 0,
      labor: [],
    });
    expect(result.gpCents).toBe(1_000);
    expect(result.explanation).toContain("No labor was clocked");
  });

  it("rejects fractional money and minutes", () => {
    expect(() =>
      jobGrossProfit({ saleCents: 10.5, partsCents: 0, otherCostsCents: 0, labor: [] }),
    ).toThrow(RangeError);
    expect(() =>
      jobGrossProfit({
        saleCents: 0,
        partsCents: 0,
        otherCostsCents: 0,
        labor: [{ workerId: "a", minutes: 1.5, burdenedCentsPerHour: 2_700 }],
      }),
    ).toThrow(RangeError);
  });
});

describe("creditGrossProfit", () => {
  it("splits by clocked time with exact cents", () => {
    const credits = creditGrossProfit(100_001, [
      { userId: "a", minutes: 60 },
      { userId: "b", minutes: 60 },
      { userId: "c", minutes: 60 },
    ]);
    expect(credits.map((c) => c.creditedGpCents)).toEqual([33_334, 33_334, 33_333]);
    expect(credits.map((c) => c.shareBps)).toEqual([3_334, 3_333, 3_333]);
    expect(credits.reduce((sum, c) => sum + c.creditedGpCents, 0)).toBe(100_001);
  });

  it("splits a negative GP job", () => {
    const credits = creditGrossProfit(-1_001, [
      { userId: "a", minutes: 30 },
      { userId: "b", minutes: 30 },
    ]);
    expect(credits.map((c) => c.creditedGpCents)).toEqual([-501, -500]);
  });

  it("merges repeated techs in a clocked split", () => {
    const credits = creditGrossProfit(1_000, [
      { userId: "a", minutes: 30 },
      { userId: "b", minutes: 60 },
      { userId: "a", minutes: 30 },
    ]);
    expect(credits.map((c) => [c.userId, c.creditedGpCents])).toEqual([
      ["a", 500],
      ["b", 500],
    ]);
  });

  it("gives a lone tech all of it", () => {
    const [credit] = creditGrossProfit(62_000, [{ userId: "a", minutes: 120 }]);
    expect(credit?.creditedGpCents).toBe(62_000);
    expect(credit?.shareBps).toBe(10_000);
    expect(credit?.explanation).toContain("only tech");
  });

  it("supports a manager's manual split with a reason", () => {
    const credits = creditGrossProfit(
      100_000,
      [
        { userId: "a", shareBps: 6_000 },
        { userId: "b", shareBps: 4_000 },
      ],
      { manualReason: "b diagnosed, a sold" },
    );
    expect(credits.map((c) => c.creditedGpCents)).toEqual([60_000, 40_000]);
    expect(credits[0]?.explanation).toContain("b diagnosed, a sold");
  });

  it("rejects bad splits", () => {
    expect(() => creditGrossProfit(100, [])).toThrow(RangeError);
    expect(() => creditGrossProfit(100, [{ userId: "a", minutes: 0 }])).toThrow(/manager/);
    expect(() => creditGrossProfit(100, [{ userId: "a", shareBps: 10_000 }])).toThrow(/reason/);
    expect(() =>
      creditGrossProfit(100, [{ userId: "a", shareBps: 9_000 }], { manualReason: "x" }),
    ).toThrow(/100%/);
    expect(() =>
      creditGrossProfit(
        100,
        [
          { userId: "a", shareBps: 5_000 },
          { userId: "a", shareBps: 5_000 },
        ],
        { manualReason: "x" },
      ),
    ).toThrow(/twice/);
    expect(() =>
      creditGrossProfit(100, [
        { userId: "a", minutes: 10 },
        { userId: "b", shareBps: 10 },
      ] as never),
    ).toThrow(TypeError);
  });
});

describe("creditJob rules", () => {
  it("credits 100% of a tech-sold replacement to the sold-by tech", () => {
    const result = creditJob({
      jobId: "R1",
      gpCents: 300_000,
      sale: { kind: "replacement_sold_by_tech", soldByUserId: "tech-a" },
      techs: [
        { userId: "installer-1", minutes: 480 },
        { userId: "installer-2", minutes: 480 },
      ],
    });
    expect(result.credits).toHaveLength(1);
    expect(result.credits[0]).toMatchObject({
      userId: "tech-a",
      shareBps: 10_000,
      creditedGpCents: 300_000,
    });
    expect(result.countsTowardWeekScore).toBe(true);
  });

  it("gives callbacks no credit", () => {
    const result = creditJob({
      jobId: "CB1",
      gpCents: -5_000,
      isCallback: true,
      techs: [{ userId: "tech-a", minutes: 60 }],
    });
    expect(result.credits).toEqual([]);
    expect(result.countsTowardWeekScore).toBe(false);
  });

  it("uses a manual split on a service job", () => {
    const result = creditJob({
      jobId: "S1",
      gpCents: 1_000,
      techs: [
        { userId: "a", minutes: 60 },
        { userId: "b", minutes: 60 },
      ],
      manualSplit: {
        reason: "a did the sale",
        shares: [
          { userId: "a", shareBps: 10_000 },
          { userId: "b", shareBps: 0 },
        ],
      },
    });
    expect(result.credits.map((c) => c.creditedGpCents)).toEqual([1_000, 0]);
  });

  it("refuses a manual split on replacements", () => {
    expect(() =>
      creditJob({
        jobId: "R2",
        gpCents: 1,
        sale: { kind: "replacement_sold_by_tech", soldByUserId: "a" },
        techs: [],
        manualSplit: { reason: "x", shares: [{ userId: "a", shareBps: 10_000 }] },
      }),
    ).toThrow(RangeError);
  });

  it("owner-sold replacement with no lead source pays nobody", () => {
    const result = creditJob({
      jobId: "R3",
      gpCents: 100_000,
      sale: { kind: "replacement_sold_by_owner_or_manager", leadSourceUserId: null },
      techs: [],
    });
    expect(result.credits).toEqual([]);
    expect(result.leadBonusUserId).toBeNull();
  });
});
