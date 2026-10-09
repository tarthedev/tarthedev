/**
 * Golden tests: every worked example in docs/02-commission-plan.md section 10, to the cent.
 * The examples use a burdened labor cost of exactly $27.00/hr (2700 cents) as input.
 */
import { describe, expect, it } from "vitest";
import {
  assemblePayRun,
  bookingRateBonus,
  callbackDeduction,
  commissionAtLockedRate,
  commissionLine,
  creditGrossProfit,
  creditJob,
  DEFAULT_LADDER,
  evaluateInvoiceSpiffs,
  jobGrossProfit,
  leadBonus,
  levelFor,
  otAdjustment,
  otTrueUp,
  payrollWeekFor,
  payWeekStart,
  reviewSpiff,
  weekCommission,
} from "../src/index";

const BURDENED_27 = 2_700;
const WAGE_21 = 2_100;
const MINIMUM_WAGE = 725;

const silver = DEFAULT_LADDER.find((step) => step.levelName === "Silver");
const gold = DEFAULT_LADDER.find((step) => step.levelName === "Gold");

function example1Job() {
  return jobGrossProfit({
    saleCents: 85_000,
    partsCents: 15_000,
    labor: [{ workerId: "tech-a", minutes: 120, burdenedCentsPerHour: BURDENED_27 }],
    otherCostsCents: 2_600,
  });
}

describe("Example 1: one job", () => {
  it("Sale $850, parts $150, labor 2.0 h × $27 = $54, card fee $26 → GP $620; Silver → $62.00", () => {
    const job = example1Job();
    expect(job.laborCents).toBe(5_400);
    expect(job.gpCents).toBe(62_000);
    expect(job.explanation).toContain("gross profit $620.00");

    const week = levelFor(510_000);
    expect(week.levelName).toBe("Silver");
    expect(commissionLine(job.gpCents, week.rateBps)).toBe(6_200);
  });
});

describe("Example 2: example week", () => {
  it("Score $5,100 → Silver → $510.00; spiffs $335.00; hourly $840.00; total $1,685.00", () => {
    const week = weekCommission([
      { jobId: "J1", creditedGpCents: 62_000 },
      { jobId: "J2", creditedGpCents: 148_000 },
      { jobId: "J3", creditedGpCents: 300_000 },
    ]);
    expect(week.scoreCents).toBe(510_000);
    expect(week.level.levelName).toBe("Silver");
    expect(week.totalCents).toBe(51_000);

    // Invoice A: UV light + surge protector + membership → Clean Air Combo.
    const invoiceA = evaluateInvoiceSpiffs({
      invoiceId: "INV-A",
      shares: [{ userId: "tech-a", shareBps: 10_000 }],
      lines: [
        { itemId: "uv-1", category: "uv_light", qty: 1 },
        { itemId: "surge-1", category: "surge_protector", qty: 1 },
        { itemId: "member-1", category: "membership", qty: 1 },
      ],
    });
    // Invoice B: UV light + membership, no surge protector, so no combo.
    const invoiceB = evaluateInvoiceSpiffs({
      invoiceId: "INV-B",
      shares: [{ userId: "tech-a", shareBps: 10_000 }],
      lines: [
        { itemId: "uv-1", category: "uv_light", qty: 1 },
        { itemId: "member-1", category: "membership", qty: 1 },
      ],
    });
    const reviews = ["J1", "J2", "J3"].map((jobId) =>
      reviewSpiff({
        jobId,
        techUserId: "tech-a",
        platform: "google",
        stars: 5,
        mentionsTechByName: true,
        visitOn: "2026-03-03",
        postedOn: "2026-03-05",
        verifiedAt: "2026-03-06T15:00:00Z",
        reviewSpiffsAlreadyOnJob: 0,
      }),
    );
    expect(invoiceA.totalCents).toBe(18_500);
    expect(invoiceB.totalCents).toBe(9_000);
    const reviewTotal = reviews.reduce((sum, r) => sum + (r.eligible ? r.amountCents : 0), 0);
    expect(reviewTotal).toBe(6_000);
    expect(invoiceA.totalCents + invoiceB.totalCents + reviewTotal).toBe(33_500);

    const weekStart = "2026-03-02";
    const run = assemblePayRun({
      mode: "practice",
      weekStart,
      minimumWageCentsPerHour: MINIMUM_WAGE,
      employees: [{ userId: "tech-a", wageCentsPerHour: WAGE_21, totalMinutes: 40 * 60 }],
      lines: [
        ...week.lines.map((line) => ({
          userId: "tech-a",
          kind: "commission" as const,
          amountCents: line.amountCents,
          explanation: line.explanation,
          attributableWeekStart: weekStart,
          sourceJobId: line.jobId,
        })),
        ...[invoiceA, invoiceB].flatMap((invoice) =>
          (invoice.byUser[0]?.lines ?? []).map((line) => ({
            userId: line.userId,
            kind: line.payLineKind,
            amountCents: line.amountCents,
            explanation: line.explanation,
            attributableWeekStart: weekStart,
          })),
        ),
        ...reviews.flatMap((review) =>
          review.eligible
            ? [
                {
                  userId: review.userId,
                  kind: review.payLineKind,
                  amountCents: review.amountCents,
                  explanation: review.explanation,
                  attributableWeekStart: weekStart,
                },
              ]
            : [],
        ),
      ],
    });
    const sheet = run.sheets[0];
    expect(sheet?.hourlyCents).toBe(84_000);
    expect(sheet?.commissionCents).toBe(51_000);
    expect(sheet?.spiffsCents).toBe(33_500);
    expect(sheet?.otAdjustmentCents).toBe(0);
    expect(sheet?.totalCents).toBe(168_500);
    expect(sheet?.explanation).toContain("= $1,685.00");
  });
});

describe("Example 3: threshold jump", () => {
  it("Score $5,900 → Silver → $590.00; score $6,000 → Gold → $720.00", () => {
    const below = weekCommission([{ jobId: "J1", creditedGpCents: 590_000 }]);
    expect(below.level.levelName).toBe("Silver");
    expect(below.totalCents).toBe(59_000);

    const at = weekCommission([{ jobId: "J1", creditedGpCents: 600_000 }]);
    expect(at.level.levelName).toBe("Gold");
    expect(at.totalCents).toBe(72_000);
  });
});

describe("Example 4: starter week", () => {
  it("Score $2,400 → 5% → $120.00", () => {
    const week = weekCommission([{ jobId: "J1", creditedGpCents: 240_000 }]);
    expect(week.level.levelName).toBe("Starter");
    expect(week.level.rateBps).toBe(500);
    expect(week.totalCents).toBe(12_000);
  });
});

describe("Example 5: exact threshold and a negative job", () => {
  it("GP $3,200, $1,500 and −$200 → score $4,500.00 → Silver; lines $320, $150, $0 → $470.00", () => {
    const week = weekCommission([
      { jobId: "J1", creditedGpCents: 320_000 },
      { jobId: "J2", creditedGpCents: 150_000 },
      { jobId: "J3", creditedGpCents: -20_000 },
    ]);
    expect(week.scoreCents).toBe(450_000);
    expect(week.level.levelName).toBe("Silver");
    expect(week.lines.map((line) => line.amountCents)).toEqual([32_000, 15_000, 0]);
    expect(week.totalCents).toBe(47_000);
  });
});

describe("Example 6: callback", () => {
  it("Example 1's $62.00 was paid in week 1; a tech-caused callback in week 3 → −$62.00 in week 3's run", () => {
    const week1 = "2026-03-02";
    const finishedOn = "2026-03-04";
    const callbackOn = "2026-03-17";
    expect(payWeekStart(finishedOn)).toBe(week1);
    const week3 = payWeekStart(callbackOn);
    expect(week3).toBe("2026-03-16");

    const decision = callbackDeduction({
      originalFinishedOn: finishedOn,
      callbackOn,
      techCaused: true,
      reason: "Missed a loose wire",
      originalCommission: { status: "paid", amountCents: 6_200 },
    });
    expect(decision).toMatchObject({ action: "deduct", amountCents: -6_200 });
    if (decision.action !== "deduct") throw new Error("expected a deduction");

    const run = assemblePayRun({
      mode: "practice",
      weekStart: week3,
      minimumWageCentsPerHour: MINIMUM_WAGE,
      employees: [{ userId: "tech-a", wageCentsPerHour: WAGE_21, totalMinutes: 40 * 60 }],
      lines: [
        {
          userId: "tech-a",
          kind: "callback_deduction",
          amountCents: decision.amountCents,
          explanation: decision.explanation,
        },
      ],
    });
    expect(run.sheets[0]?.deductionsCents).toBe(-6_200);
    expect(run.sheets[0]?.carryForwardCents).toBe(0);
    expect(run.sheets[0]?.totalCents).toBe(84_000 - 6_200);
  });
});

describe("Example 7: not tech-caused callback", () => {
  it("Marked 'part failed from factory' → no deduction", () => {
    const decision = callbackDeduction({
      originalFinishedOn: "2026-03-04",
      callbackOn: "2026-03-17",
      techCaused: false,
      reason: "part failed from factory",
      originalCommission: { status: "paid", amountCents: 6_200 },
    });
    expect(decision.action).toBe("none");
    expect(decision).toMatchObject({ reason: "not_tech_caused" });
    expect(decision.explanation).toContain("part failed from factory");
  });
});

describe("Example 8: late commercial payment with overtime", () => {
  it("GP $1,000 finished in Gold week 1 (45 h), paid week 6 → $120.00 in week 6 plus $6.67 true-up", () => {
    const week1 = "2026-03-02";
    if (!gold) throw new Error("Gold step missing");
    const line = commissionAtLockedRate({
      jobId: "COM-1",
      creditedGpCents: 100_000,
      finishedWeek: {
        weekStart: week1,
        levelName: gold.levelName,
        rateBps: gold.rateBps,
        lockedAt: "2026-03-09T04:00:00Z",
      },
    });
    expect(line.amountCents).toBe(12_000);

    const week6 = payrollWeekFor("2026-04-08T14:30:00-04:00");
    expect(week6).toBe("2026-04-06");

    expect(otAdjustment(12_000, 45 * 60, 5 * 60)).toBe(667);
    expect(
      otTrueUp({
        weekStart: week1,
        totalMinutes: 45 * 60,
        otMinutes: 5 * 60,
        previouslyAttributedCents: 0,
        newlyAttributedCents: 12_000,
        adjustmentAlreadyPaidCents: 0,
      }).amountCents,
    ).toBe(667);

    const run = assemblePayRun({
      mode: "practice",
      weekStart: week6,
      minimumWageCentsPerHour: MINIMUM_WAGE,
      employees: [{ userId: "tech-a", wageCentsPerHour: WAGE_21, totalMinutes: 40 * 60 }],
      priorWeeks: [
        {
          userId: "tech-a",
          weekStart: week1,
          totalMinutes: 45 * 60,
          otMinutes: 5 * 60,
          attributedCents: 0,
          adjustmentPaidCents: 0,
        },
      ],
      lines: [
        {
          userId: "tech-a",
          kind: "commission",
          amountCents: line.amountCents,
          explanation: line.explanation,
          attributableWeekStart: week1,
          sourceJobId: "COM-1",
        },
      ],
    });
    const sheet = run.sheets[0];
    expect(sheet?.commissionCents).toBe(12_000);
    expect(sheet?.otAdjustmentCents).toBe(667);
    const trueUp = sheet?.lines.find((l) => l.kind === "ot_true_up");
    expect(trueUp).toMatchObject({ amountCents: 667, attributableWeekStart: week1 });
    expect(trueUp?.explanation).toContain("$6.67");
  });
});

describe("Example 9: combo", () => {
  it("UV light, surge protector and membership on one invoice → $185.00", () => {
    const result = evaluateInvoiceSpiffs({
      invoiceId: "INV-9",
      shares: [{ userId: "tech-a", shareBps: 10_000 }],
      lines: [
        { itemId: "uv-1", category: "uv_light", qty: 1 },
        { itemId: "surge-1", category: "surge_protector", qty: 1 },
        { itemId: "member-1", category: "membership", qty: 1 },
      ],
    });
    expect(result.awards.map((award) => [award.label, award.amountCents])).toEqual([
      ["UV light", 5_000],
      ["Surge protector", 2_000],
      ["Membership sold", 4_000],
      ["Clean Air Combo", 7_500],
    ]);
    expect(result.totalCents).toBe(18_500);
  });
});

describe("Example 10: split job", () => {
  it("$1,000 GP, 3 h and 1 h clocked → $750 and $250, each at their own week's rate", () => {
    const credits = creditGrossProfit(100_000, [
      { userId: "tech-a", minutes: 180 },
      { userId: "tech-b", minutes: 60 },
    ]);
    expect(credits.map((c) => [c.userId, c.creditedGpCents, c.shareBps])).toEqual([
      ["tech-a", 75_000, 7_500],
      ["tech-b", 25_000, 2_500],
    ]);
    if (!gold || !silver) throw new Error("ladder steps missing");
    // tech-a had a Gold week, tech-b a Silver week.
    expect(commissionLine(75_000, gold.rateBps)).toBe(9_000);
    expect(commissionLine(25_000, silver.rateBps)).toBe(2_500);
  });
});

describe("Example 11: owner-sold replacement", () => {
  it("Lead-source tech gets a $150.00 lead bonus when paid in full and no GP credit", () => {
    const credit = creditJob({
      jobId: "REPL-1",
      gpCents: 420_000,
      sale: { kind: "replacement_sold_by_owner_or_manager", leadSourceUserId: "tech-a" },
      techs: [{ userId: "installer-1", minutes: 480 }],
    });
    expect(credit.credits).toEqual([]);
    expect(credit.countsTowardWeekScore).toBe(false);
    expect(credit.leadBonusUserId).toBe("tech-a");

    const bonus = leadBonus({
      jobId: "REPL-1",
      leadSourceUserId: credit.leadBonusUserId,
      soldBy: "owner",
      paidInFull: true,
    });
    expect(bonus).toMatchObject({
      eligible: true,
      userId: "tech-a",
      amountCents: 15_000,
      status: "payable",
      payLineKind: "lead",
    });
  });
});

describe("Example 12: CSR week", () => {
  it("90 bookable, 76 booked → 84.4% → $50.00", () => {
    const result = bookingRateBonus({ userId: "csr-1", bookableCalls: 90, bookedCalls: 76 });
    expect(result.rateBps).toBe(8_444);
    expect(result.amountCents).toBe(5_000);
  });

  it("25 bookable calls at 92% → $0 (under the 30-call minimum)", () => {
    const result = bookingRateBonus({ userId: "csr-1", bookableCalls: 25, bookedCalls: 23 });
    expect(result.rateBps).toBe(9_200);
    expect(result.qualified).toBe(false);
    expect(result.amountCents).toBe(0);
  });
});
