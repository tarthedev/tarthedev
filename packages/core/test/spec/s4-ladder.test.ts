/**
 * Spec tests for docs/02-commission-plan.md section 4: the Profit Ladder.
 */
import { describe, expect, it } from "vitest";
import {
  commissionAtLockedRate,
  commissionLine,
  DEFAULT_LADDER,
  type EffectiveDated,
  type LadderStep,
  levelFor,
  nextLevel,
  pickEffectiveGroup,
  weekCommission,
} from "../../src/index";

describe("The ladder table", () => {
  it("has the five starting levels, thresholds and rates", () => {
    expect(DEFAULT_LADDER.map((s) => [s.levelName, s.minWeekGpCents, s.rateBps])).toEqual([
      ["Starter", 0, 500],
      ["Bronze", 300_000, 800],
      ["Silver", 450_000, 1_000],
      ["Gold", 600_000, 1_200],
      ["Platinum", 800_000, 1_400],
    ]);
  });

  it.each([
    [-100_000, "Starter", 500],
    [-1, "Starter", 500],
    [0, "Starter", 500],
    [240_000, "Starter", 500],
    [299_999, "Starter", 500],
    [300_000, "Bronze", 800],
    [449_999, "Bronze", 800],
    [450_000, "Silver", 1_000],
    [599_999, "Silver", 1_000],
    [600_000, "Gold", 1_200],
    [799_999, "Gold", 1_200],
    [800_000, "Platinum", 1_400],
    [10_000_000, "Platinum", 1_400],
  ])("week score %i cents → %s (%i bps); thresholds are inclusive", (score, name, rate) => {
    const level = levelFor(score);
    expect(level.levelName).toBe(name);
    expect(level.rateBps).toBe(rate);
  });

  it("tells the tech how far the next level is", () => {
    expect(nextLevel(449_999)).toMatchObject({ step: { levelName: "Silver" }, neededCents: 1 });
    expect(nextLevel(450_000)).toMatchObject({ step: { levelName: "Gold" }, neededCents: 150_000 });
    expect(nextLevel(-50_000)).toMatchObject({
      step: { levelName: "Bronze" },
      neededCents: 350_000,
    });
    expect(nextLevel(800_000)).toBeNull();
  });
});

describe("Week score includes negative-GP jobs", () => {
  it("a negative job can drop the tech a level, and then every line pays the lower rate", () => {
    const week = weekCommission([
      { jobId: "J1", creditedGpCents: 300_000 },
      { jobId: "J2", creditedGpCents: -1 },
    ]);
    expect(week.scoreCents).toBe(299_999);
    expect(week.level.levelName).toBe("Starter");
    expect(week.lines.map((l) => l.amountCents)).toEqual([15_000, 0]);
    expect(week.totalCents).toBe(15_000);
  });

  it("a week of only negative jobs pays $0, never less", () => {
    const week = weekCommission([
      { jobId: "J1", creditedGpCents: -50_000 },
      { jobId: "J2", creditedGpCents: -1 },
    ]);
    expect(week.scoreCents).toBe(-50_001);
    expect(week.level.levelName).toBe("Starter");
    expect(week.totalCents).toBe(0);
    for (const line of week.lines) {
      expect(Object.is(line.amountCents, 0)).toBe(true);
    }
  });

  it("an empty week scores $0 at Starter and pays nothing", () => {
    const week = weekCommission([]);
    expect(week.scoreCents).toBe(0);
    expect(week.level.levelName).toBe("Starter");
    expect(week.totalCents).toBe(0);
  });
});

describe("The rate applies to all of the week's GP (whole-week jump, not tax brackets)", () => {
  it("reaching Gold pays 12% on every dollar, including the first $3,000", () => {
    const week = weekCommission([
      { jobId: "J1", creditedGpCents: 300_000 },
      { jobId: "J2", creditedGpCents: 300_000 },
    ]);
    expect(week.level.levelName).toBe("Gold");
    expect(week.lines.map((l) => l.amountCents)).toEqual([36_000, 36_000]);
    // Brackets would have paid 5%·3000 + 8%·1500 + 10%·1500 = $420, not $720.
    expect(week.totalCents).toBe(72_000);
    for (const line of week.lines) expect(line.rateBps).toBe(1_200);
  });

  it("Platinum pays 14% on the whole week", () => {
    const week = weekCommission([{ jobId: "J1", creditedGpCents: 800_000 }]);
    expect(week.totalCents).toBe(112_000);
  });
});

describe("Commission line per job = max(0, rate × credited GP), rounded half-up to the cent", () => {
  it.each([
    [62_000, 1_000, 6_200],
    [12_345, 500, 617], // 617.25
    [12_350, 500, 618], // 617.5 rounds up
    [12_349, 500, 617], // 617.45
    [5, 1_000, 1], // 0.5 rounds up
    [4, 1_000, 0], // 0.4
    [1, 1_400, 0], // 0.14
    [0, 1_400, 0],
    [-12_350, 500, 0],
    [-1, 1_400, 0],
  ])("credited GP %i × %i bps → %i", (gp, rate, expected) => {
    const line = commissionLine(gp, rate);
    expect(line).toBe(expected);
    expect(Object.is(line, -0)).toBe(false);
  });

  it("rounds each line, and the week total is the sum of rounded lines", () => {
    const week = weekCommission([
      { jobId: "J1", creditedGpCents: 12_350 },
      { jobId: "J2", creditedGpCents: 12_350 },
    ]);
    expect(week.lines.map((l) => l.amountCents)).toEqual([618, 618]);
    // 5% of the $247.00 total would be $12.35; per-line rounding gives $12.36.
    expect(week.totalCents).toBe(1_236);
  });

  it("every line has a plain-English explanation", () => {
    const week = weekCommission([
      { jobId: "J1", creditedGpCents: 470_000 },
      { jobId: "J2", creditedGpCents: -20_000 },
    ]);
    for (const line of week.lines) expect(line.explanation.length).toBeGreaterThan(10);
    expect(week.explanation).toContain("Silver");
  });

  it("rejects fractional cents", () => {
    expect(() => commissionLine(100.5, 1_000)).toThrow();
    expect(() => commissionLine(100, 10.5)).toThrow();
  });
});

describe("The week's level and rate lock Sunday night", () => {
  it("a commission can't be paid at a week's rate before that week locks", () => {
    expect(() =>
      commissionAtLockedRate({
        jobId: "J1",
        creditedGpCents: 100_000,
        finishedWeek: {
          weekStart: "2026-10-05",
          levelName: "Gold",
          rateBps: 1_200,
          lockedAt: null,
        },
      }),
    ).toThrow();
  });

  it("ladder steps are effective-dated settings; a new version doesn't rewrite old weeks", () => {
    type Row = LadderStep & EffectiveDated;
    const old: Row[] = DEFAULT_LADDER.map((s) => ({ ...s, effectiveFrom: "2026-01-05" }));
    const tuned: Row[] = [
      { levelName: "Starter", minWeekGpCents: 0, rateBps: 500, effectiveFrom: "2026-11-02" },
      { levelName: "Bronze", minWeekGpCents: 250_000, rateBps: 800, effectiveFrom: "2026-11-02" },
      { levelName: "Silver", minWeekGpCents: 400_000, rateBps: 1_000, effectiveFrom: "2026-11-02" },
    ];
    const rows = [...old, ...tuned];
    const before = pickEffectiveGroup(rows, "2026-10-26");
    const after = pickEffectiveGroup(rows, "2026-11-02");
    expect(before).toHaveLength(5);
    expect(after).toHaveLength(3);
    expect(levelFor(420_000, before).levelName).toBe("Bronze");
    expect(levelFor(420_000, after).levelName).toBe("Silver");
  });
});
