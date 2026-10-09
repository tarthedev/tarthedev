/**
 * Spec tests for docs/02-commission-plan.md section 3: who gets credit for a job's GP.
 */
import { describe, expect, it } from "vitest";
import {
  creditGrossProfit,
  creditJob,
  leadBonus,
  weekCommission,
  weekScore,
} from "../../src/index";

describe("Default: split among the techs in proportion to clocked time", () => {
  it("3 h and 1 h on a $1,000 job → $750 and $250", () => {
    const credits = creditGrossProfit(100_000, [
      { userId: "a", minutes: 180 },
      { userId: "b", minutes: 60 },
    ]);
    expect(credits.map((c) => [c.userId, c.creditedGpCents, c.shareBps])).toEqual([
      ["a", 75_000, 7_500],
      ["b", 25_000, 2_500],
    ]);
  });

  it("one tech gets all of it", () => {
    const [only] = creditGrossProfit(62_000, [{ userId: "a", minutes: 120 }]);
    expect(only?.creditedGpCents).toBe(62_000);
    expect(only?.shareBps).toBe(10_000);
  });

  it("the parts always add up exactly to the job's GP", () => {
    const credits = creditGrossProfit(10_000, [
      { userId: "a", minutes: 60 },
      { userId: "b", minutes: 60 },
      { userId: "c", minutes: 60 },
    ]);
    const amounts = credits.map((c) => c.creditedGpCents);
    expect(amounts.reduce((sum, v) => sum + v, 0)).toBe(10_000);
    expect(Math.max(...amounts) - Math.min(...amounts)).toBeLessThanOrEqual(1);
    for (const amount of amounts) expect(Number.isInteger(amount)).toBe(true);
  });

  it("an odd cent is not lost or created", () => {
    const credits = creditGrossProfit(100_001, [
      { userId: "a", minutes: 30 },
      { userId: "b", minutes: 30 },
    ]);
    expect(credits.reduce((sum, c) => sum + c.creditedGpCents, 0)).toBe(100_001);
  });

  it("a negative-GP job is split the same way (each tech's share is negative)", () => {
    const credits = creditGrossProfit(-10_000, [
      { userId: "a", minutes: 180 },
      { userId: "b", minutes: 60 },
    ]);
    expect(credits.map((c) => c.creditedGpCents)).toEqual([-7_500, -2_500]);
  });

  it("a service job credited through creditJob uses the clocked split", () => {
    const result = creditJob({
      jobId: "J1",
      gpCents: 100_000,
      techs: [
        { userId: "a", minutes: 180 },
        { userId: "b", minutes: 60 },
      ],
    });
    expect(result.countsTowardWeekScore).toBe(true);
    expect(result.leadBonusUserId).toBeNull();
    expect(result.credits.map((c) => c.creditedGpCents)).toEqual([75_000, 25_000]);
  });
});

describe("A manager can set a different split with a reason", () => {
  it("uses the manager's shares and shows the reason", () => {
    const result = creditJob({
      jobId: "J2",
      gpCents: 100_000,
      techs: [
        { userId: "a", minutes: 180 },
        { userId: "b", minutes: 60 },
      ],
      manualSplit: {
        shares: [
          { userId: "a", shareBps: 5_000 },
          { userId: "b", shareBps: 5_000 },
        ],
        reason: "B diagnosed the problem",
      },
    });
    expect(result.credits.map((c) => c.creditedGpCents)).toEqual([50_000, 50_000]);
    expect(result.credits[0]?.explanation).toContain("B diagnosed the problem");
  });

  it("requires a reason", () => {
    expect(() =>
      creditGrossProfit(100_000, [
        { userId: "a", shareBps: 6_000 },
        { userId: "b", shareBps: 4_000 },
      ]),
    ).toThrow();
    expect(() =>
      creditGrossProfit(
        100_000,
        [
          { userId: "a", shareBps: 6_000 },
          { userId: "b", shareBps: 4_000 },
        ],
        { manualReason: "   " },
      ),
    ).toThrow();
  });

  it("the manual shares must add up to 100%", () => {
    expect(() =>
      creditGrossProfit(
        100_000,
        [
          { userId: "a", shareBps: 6_000 },
          { userId: "b", shareBps: 3_000 },
        ],
        { manualReason: "typo" },
      ),
    ).toThrow();
  });
});

describe("Replacement sold by a tech: 100% of the install's GP to the sold-by tech", () => {
  it("credits the seller even though only installers clocked time on the install", () => {
    const result = creditJob({
      jobId: "INSTALL-1",
      gpCents: 400_000,
      sale: { kind: "replacement_sold_by_tech", soldByUserId: "seller" },
      techs: [
        { userId: "installer-1", minutes: 480 },
        { userId: "installer-2", minutes: 480 },
      ],
    });
    expect(result.countsTowardWeekScore).toBe(true);
    expect(result.credits).toHaveLength(1);
    expect(result.credits[0]).toMatchObject({
      userId: "seller",
      shareBps: 10_000,
      creditedGpCents: 400_000,
    });
    expect(result.leadBonusUserId).toBeNull();
  });

  it("is still 100% to the seller when the seller also worked the install", () => {
    const result = creditJob({
      jobId: "INSTALL-2",
      gpCents: 300_000,
      sale: { kind: "replacement_sold_by_tech", soldByUserId: "seller" },
      techs: [
        { userId: "seller", minutes: 60 },
        { userId: "installer-1", minutes: 480 },
      ],
    });
    expect(result.credits.map((c) => [c.userId, c.creditedGpCents])).toEqual([["seller", 300_000]]);
  });
});

describe("Replacement sold by an owner or manager: no GP credit; lead source gets $150", () => {
  it("credits no tech and names the lead-source tech", () => {
    const result = creditJob({
      jobId: "INSTALL-3",
      gpCents: 500_000,
      sale: { kind: "replacement_sold_by_owner_or_manager", leadSourceUserId: "lead-tech" },
      techs: [{ userId: "installer-1", minutes: 480 }],
    });
    expect(result.credits).toEqual([]);
    expect(result.countsTowardWeekScore).toBe(false);
    expect(result.leadBonusUserId).toBe("lead-tech");
  });

  it("the lead bonus waits until the customer pays in full", () => {
    const unpaid = leadBonus({
      jobId: "INSTALL-3",
      leadSourceUserId: "lead-tech",
      soldBy: "owner",
      paidInFull: false,
    });
    expect(unpaid).toMatchObject({
      eligible: true,
      amountCents: 15_000,
      status: "pending_payment",
    });
    const paid = leadBonus({
      jobId: "INSTALL-3",
      leadSourceUserId: "lead-tech",
      soldBy: "manager",
      paidInFull: true,
    });
    expect(paid).toMatchObject({
      eligible: true,
      userId: "lead-tech",
      amountCents: 15_000,
      status: "payable",
    });
  });

  it("no lead bonus when no tech is the lead source or a tech sold it", () => {
    expect(
      leadBonus({ jobId: "X", leadSourceUserId: null, soldBy: "owner", paidInFull: true }).eligible,
    ).toBe(false);
    expect(
      leadBonus({ jobId: "X", leadSourceUserId: "t", soldBy: "tech", paidInFull: true }).eligible,
    ).toBe(false);
  });
});

describe("Callback and warranty visits are excluded from every week score", () => {
  it("creditJob gives a callback no credit and keeps it out of the week score", () => {
    const result = creditJob({
      jobId: "CB-1",
      gpCents: 25_000,
      isCallback: true,
      techs: [{ userId: "a", minutes: 60 }],
    });
    expect(result.countsTowardWeekScore).toBe(false);
    expect(result.credits).toEqual([]);
  });

  it("weekScore ignores callback credits, positive or negative", () => {
    expect(
      weekScore([
        { jobId: "J1", creditedGpCents: 450_000 },
        { jobId: "CB", creditedGpCents: 200_000, isCallback: true },
      ]),
    ).toBe(450_000);
    expect(
      weekScore([
        { jobId: "J1", creditedGpCents: 450_000 },
        { jobId: "CB", creditedGpCents: -200_000, isCallback: true },
      ]),
    ).toBe(450_000);
  });

  it("a callback doesn't push the tech up a level or earn a commission line", () => {
    const week = weekCommission([
      { jobId: "J1", creditedGpCents: 400_000 },
      { jobId: "CB", creditedGpCents: 100_000, isCallback: true },
    ]);
    expect(week.scoreCents).toBe(400_000);
    expect(week.level.levelName).toBe("Bronze");
    expect(week.lines.map((line) => line.jobId)).toEqual(["J1"]);
    expect(week.totalCents).toBe(32_000);
  });
});
