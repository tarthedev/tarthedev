import { describe, expect, it } from "vitest";
import {
  commissionLine,
  DEFAULT_LADDER,
  type LadderStep,
  levelFor,
  nextLevel,
  validateLadder,
  weekCommission,
  weekScore,
} from "../src/index";

describe("default ladder", () => {
  it("matches the commission plan", () => {
    expect(DEFAULT_LADDER.map((s) => [s.levelName, s.minWeekGpCents, s.rateBps])).toEqual([
      ["Starter", 0, 500],
      ["Bronze", 300_000, 800],
      ["Silver", 450_000, 1_000],
      ["Gold", 600_000, 1_200],
      ["Platinum", 800_000, 1_400],
    ]);
    expect(Object.isFrozen(DEFAULT_LADDER)).toBe(true);
  });
});

describe("levelFor uses inclusive thresholds", () => {
  it.each([
    [-50_000, "Starter"],
    [0, "Starter"],
    [299_999, "Starter"],
    [300_000, "Bronze"],
    [449_999, "Bronze"],
    [450_000, "Silver"],
    [599_999, "Silver"],
    [600_000, "Gold"],
    [799_999, "Gold"],
    [800_000, "Platinum"],
    [5_000_000, "Platinum"],
  ])("%i cents → %s", (score, level) => {
    expect(levelFor(score).levelName).toBe(level);
  });

  it("works with an unsorted custom ladder", () => {
    const ladder: LadderStep[] = [
      { levelName: "High", minWeekGpCents: 100_000, rateBps: 900 },
      { levelName: "Low", minWeekGpCents: 0, rateBps: 400 },
    ];
    expect(levelFor(100_000, ladder).levelName).toBe("High");
    expect(levelFor(99_999, ladder).levelName).toBe("Low");
  });

  it("rejects bad ladders", () => {
    expect(() => validateLadder([])).toThrow(RangeError);
    expect(() =>
      validateLadder([
        { levelName: "A", minWeekGpCents: 0, rateBps: 500 },
        { levelName: "B", minWeekGpCents: 0, rateBps: 800 },
      ]),
    ).toThrow(/same score/);
    expect(() => validateLadder([{ levelName: "A", minWeekGpCents: 0, rateBps: 10_001 }])).toThrow(
      RangeError,
    );
    expect(() => validateLadder([{ levelName: "A", minWeekGpCents: 0, rateBps: 5.5 }])).toThrow(
      RangeError,
    );
  });
});

describe("nextLevel", () => {
  it("says how far the next level is", () => {
    expect(nextLevel(440_000)).toMatchObject({
      step: { levelName: "Silver" },
      neededCents: 10_000,
    });
    expect(nextLevel(450_000)).toMatchObject({ step: { levelName: "Gold" }, neededCents: 150_000 });
    expect(nextLevel(800_000)).toBeNull();
  });
});

describe("weekScore", () => {
  it("includes negative jobs and excludes callbacks", () => {
    expect(
      weekScore([
        { jobId: "a", creditedGpCents: 300_000 },
        { jobId: "b", creditedGpCents: -20_000 },
        { jobId: "cb", creditedGpCents: 999_999, isCallback: true },
      ]),
    ).toBe(280_000);
    expect(weekScore([])).toBe(0);
  });
});

describe("commissionLine", () => {
  it("never goes below zero and rounds half-up", () => {
    expect(commissionLine(-20_000, 1_000)).toBe(0);
    expect(Object.is(commissionLine(-1, 1_000), 0)).toBe(true);
    expect(commissionLine(12_345, 500)).toBe(617);
    expect(commissionLine(12_350, 500)).toBe(618);
    expect(commissionLine(5, 1_000)).toBe(1); // 0.5 cent → 1 cent
    expect(() => commissionLine(100, -1)).toThrow(RangeError);
  });
});

describe("weekCommission", () => {
  it("applies the week's rate to every job (whole-week jump, not brackets)", () => {
    const week = weekCommission([
      { jobId: "a", creditedGpCents: 400_000 },
      { jobId: "b", creditedGpCents: 400_000 },
    ]);
    expect(week.level.levelName).toBe("Platinum");
    expect(week.lines.map((l) => l.amountCents)).toEqual([56_000, 56_000]);
    expect(week.totalCents).toBe(112_000);
  });

  it("a week with only negative jobs pays zero", () => {
    const week = weekCommission([
      { jobId: "a", creditedGpCents: -10_000 },
      { jobId: "b", creditedGpCents: -5_000 },
    ]);
    expect(week.scoreCents).toBe(-15_000);
    expect(week.level.levelName).toBe("Starter");
    expect(week.totalCents).toBe(0);
    expect(week.lines[0]?.explanation).toContain("never makes negative commission");
  });

  it("a negative job can pull the week below a threshold", () => {
    const week = weekCommission([
      { jobId: "a", creditedGpCents: 450_000 },
      { jobId: "b", creditedGpCents: -1 },
    ]);
    expect(week.level.levelName).toBe("Bronze");
    expect(week.totalCents).toBe(36_000);
  });

  it("callback jobs make no commission line", () => {
    const week = weekCommission([
      { jobId: "a", creditedGpCents: 100_000 },
      { jobId: "cb", creditedGpCents: 50_000, isCallback: true },
    ]);
    expect(week.lines.map((l) => l.jobId)).toEqual(["a"]);
    expect(week.totalCents).toBe(5_000);
  });

  it("explains each line", () => {
    const week = weekCommission([{ jobId: "J1", creditedGpCents: 62_000 }], DEFAULT_LADDER);
    expect(week.lines[0]?.explanation).toBe(
      "Job J1: your credited gross profit $620.00 × 5% (Starter week) = $31.00.",
    );
  });
});
