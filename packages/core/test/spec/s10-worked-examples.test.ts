/**
 * Spec tests for docs/02-commission-plan.md section 10, built independently from the doc.
 * Wage $21/hr; the examples pass a burdened cost of exactly $27.00/hr as input.
 * Calendar: week 1 = Monday 2026-10-05, week 3 = 2026-10-19, week 6 = 2026-11-09.
 */
import { describe, expect, it } from "vitest";
import {
  assemblePayRun,
  bookingRateBonus,
  callbackDeduction,
  commissionAtLockedRate,
  commissionLine,
  creditJob,
  evaluateInvoiceSpiffs,
  jobGrossProfit,
  leadBonus,
  levelFor,
  otAdjustment,
  payrollWeekFor,
  payWeekStart,
  reviewSpiff,
  weekCommission,
  weekLocksAt,
} from "../../src/index";

const BURDENED = 2_700;
const WAGE = 2_100;
const WEEK_1 = "2026-10-05";
const WEEK_3 = "2026-10-19";
const WEEK_6 = "2026-11-09";
const solo = [{ userId: "tech", shareBps: 10_000 }];

function example1() {
  return jobGrossProfit({
    saleCents: 85_000,
    partsCents: 15_000,
    labor: [{ workerId: "tech", minutes: 120, burdenedCentsPerHour: BURDENED }],
    otherCostsCents: 2_600,
  });
}

describe("Example 1: one job", () => {
  it("$850 − $150 − 2.0 h × $27 − $26 = $620 GP; Silver → $62.00", () => {
    const job = example1();
    expect(job.laborCents).toBe(5_400);
    expect(job.gpCents).toBe(62_000);
    const credit = creditJob({
      jobId: "J1",
      gpCents: job.gpCents,
      techs: [{ userId: "tech", minutes: 120 }],
    });
    expect(credit.credits[0]?.creditedGpCents).toBe(62_000);
    expect(commissionLine(62_000, levelFor(450_000).rateBps)).toBe(6_200);
  });
});

describe("Example 2: example week", () => {
  it("score $5,100 → Silver → $510; spiffs $335; hourly $840; total $1,685", () => {
    const week = weekCommission([
      { jobId: "J1", creditedGpCents: 62_000 },
      { jobId: "J2", creditedGpCents: 218_000 },
      { jobId: "J3", creditedGpCents: 230_000 },
    ]);
    expect(week.scoreCents).toBe(510_000);
    expect(week.level.levelName).toBe("Silver");
    expect(week.totalCents).toBe(51_000);

    // 2 UV lights, 2 memberships, 1 surge protector; one invoice completes the Clean Air Combo.
    const invoiceA = evaluateInvoiceSpiffs({
      invoiceId: "A",
      shares: solo,
      lines: [
        { itemId: "uv", category: "uv_light", qty: 1 },
        { itemId: "surge", category: "surge_protector", qty: 1 },
        { itemId: "mem", category: "membership", qty: 1 },
      ],
    });
    const invoiceB = evaluateInvoiceSpiffs({
      invoiceId: "B",
      shares: solo,
      lines: [
        { itemId: "uv", category: "uv_light", qty: 1 },
        { itemId: "mem", category: "membership", qty: 1 },
      ],
    });
    const review = (jobId: string) =>
      reviewSpiff({
        jobId,
        techUserId: "tech",
        platform: "google",
        stars: 5,
        mentionsTechByName: true,
        visitOn: "2026-10-06",
        postedOn: "2026-10-07",
        verifiedAt: "2026-10-08T15:00:00Z",
        reviewSpiffsAlreadyOnJob: 0,
      });
    const reviews = ["J1", "J2", "J3"].map(review);
    const reviewCents = reviews.reduce((sum, r) => sum + (r.eligible ? r.amountCents : 0), 0);
    expect(invoiceA.totalCents).toBe(18_500);
    expect(invoiceB.totalCents).toBe(9_000);
    expect(reviewCents).toBe(6_000);
    const spiffCents = invoiceA.totalCents + invoiceB.totalCents + reviewCents;
    expect(spiffCents).toBe(33_500);

    const run = assemblePayRun({
      mode: "live",
      weekStart: WEEK_1,
      minimumWageCentsPerHour: 725,
      employees: [{ userId: "tech", wageCentsPerHour: WAGE, totalMinutes: 2_400 }],
      lines: [
        ...week.lines.map((l) => ({
          userId: "tech",
          kind: "commission" as const,
          amountCents: l.amountCents,
          explanation: l.explanation,
          attributableWeekStart: WEEK_1,
        })),
        {
          userId: "tech",
          kind: "spiff" as const,
          amountCents: spiffCents,
          explanation: "Spiffs and bonuses",
          attributableWeekStart: WEEK_1,
        },
      ],
    });
    const sheet = run.sheets[0];
    expect(sheet?.hourlyCents).toBe(84_000);
    expect(sheet?.commissionCents).toBe(51_000);
    expect(sheet?.spiffsCents).toBe(33_500);
    expect(sheet?.otAdjustmentCents).toBe(0);
    expect(sheet?.totalCents).toBe(168_500);
  });
});

describe("Example 3: threshold jump", () => {
  it("$5,900 → Silver → $590.00; $6,000 → Gold → $720.00", () => {
    const below = weekCommission([{ jobId: "J1", creditedGpCents: 590_000 }]);
    expect(below.level.levelName).toBe("Silver");
    expect(below.totalCents).toBe(59_000);
    const at = weekCommission([{ jobId: "J1", creditedGpCents: 600_000 }]);
    expect(at.level.levelName).toBe("Gold");
    expect(at.totalCents).toBe(72_000);
  });
});

describe("Example 4: Starter week", () => {
  it("$2,400 → 5% → $120.00", () => {
    const week = weekCommission([{ jobId: "J1", creditedGpCents: 240_000 }]);
    expect(week.level.levelName).toBe("Starter");
    expect(week.totalCents).toBe(12_000);
  });
});

describe("Example 5: exact threshold and a negative job", () => {
  it("$3,200 + $1,500 − $200 = $4,500.00 → Silver; lines $320, $150, $0 → $470.00", () => {
    const week = weekCommission([
      { jobId: "J1", creditedGpCents: 320_000 },
      { jobId: "J2", creditedGpCents: 150_000 },
      { jobId: "J3", creditedGpCents: -20_000 },
    ]);
    expect(week.scoreCents).toBe(450_000);
    expect(week.level.levelName).toBe("Silver");
    expect(week.lines.map((l) => l.amountCents)).toEqual([32_000, 15_000, 0]);
    expect(week.totalCents).toBe(47_000);
  });
});

describe("Examples 6 and 7: callbacks", () => {
  const finishedOn = "2026-10-06"; // week 1
  const callbackOn = "2026-10-21"; // week 3
  const original = commissionAtLockedRate({
    jobId: "J1",
    creditedGpCents: example1().gpCents,
    finishedWeek: {
      weekStart: WEEK_1,
      levelName: "Silver",
      rateBps: 1_000,
      lockedAt: weekLocksAt(WEEK_1),
    },
  });

  it("6: $62.00 paid in week 1's run; tech-caused callback in week 3 → −$62.00 in week 3's run", () => {
    expect(original.amountCents).toBe(6_200);
    expect(payWeekStart(callbackOn)).toBe(WEEK_3);
    const decision = callbackDeduction({
      originalFinishedOn: finishedOn,
      callbackOn,
      techCaused: true,
      originalCommission: { status: "paid", amountCents: original.amountCents },
    });
    expect(decision).toMatchObject({ action: "deduct", amountCents: -6_200 });
    if (decision.action !== "deduct") return;

    const run = assemblePayRun({
      mode: "live",
      weekStart: WEEK_3,
      minimumWageCentsPerHour: 725,
      employees: [{ userId: "tech", wageCentsPerHour: WAGE, totalMinutes: 2_400 }],
      lines: [
        {
          userId: "tech",
          kind: "callback_deduction",
          amountCents: decision.amountCents,
          explanation: decision.explanation,
          sourceJobId: "J1",
        },
      ],
    });
    const sheet = run.sheets[0];
    expect(sheet?.deductionsCents).toBe(-6_200);
    expect(sheet?.carryForwardCents).toBe(0);
    expect(sheet?.totalCents).toBe(84_000 - 6_200);
  });

  it("7: marked 'part failed from factory' → no deduction", () => {
    const decision = callbackDeduction({
      originalFinishedOn: finishedOn,
      callbackOn,
      techCaused: false,
      reason: "part failed from factory",
      originalCommission: { status: "paid", amountCents: original.amountCents },
    });
    expect(decision.action).toBe("none");
  });
});

describe("Example 8: late commercial payment with overtime", () => {
  it("finished week 1 (Gold, 45 h), paid week 6 → $120.00 plus OT true-up $6.67", () => {
    const line = commissionAtLockedRate({
      jobId: "COMM",
      creditedGpCents: 100_000,
      finishedWeek: {
        weekStart: WEEK_1,
        levelName: "Gold",
        rateBps: 1_200,
        lockedAt: weekLocksAt(WEEK_1),
      },
    });
    expect(line.amountCents).toBe(12_000);
    expect(payrollWeekFor("2026-11-11T17:00:00Z")).toBe(WEEK_6);
    expect(otAdjustment(12_000, 45 * 60, 5 * 60)).toBe(667);

    const run = assemblePayRun({
      mode: "live",
      weekStart: WEEK_6,
      minimumWageCentsPerHour: 725,
      employees: [{ userId: "tech", wageCentsPerHour: WAGE, totalMinutes: 2_400 }],
      lines: [
        {
          userId: "tech",
          kind: "commission",
          amountCents: line.amountCents,
          explanation: line.explanation,
          attributableWeekStart: line.attributableWeekStart,
          sourceJobId: "COMM",
        },
      ],
      priorWeeks: [
        {
          userId: "tech",
          weekStart: WEEK_1,
          totalMinutes: 2_700,
          otMinutes: 300,
          attributedCents: 0,
          adjustmentPaidCents: 0,
        },
      ],
    });
    const sheet = run.sheets[0];
    expect(sheet?.commissionCents).toBe(12_000);
    const trueUps = sheet?.lines.filter((l) => l.kind === "ot_true_up") ?? [];
    expect(trueUps.map((l) => [l.attributableWeekStart, l.amountCents])).toEqual([[WEEK_1, 667]]);
    expect(sheet?.totalCents).toBe(84_000 + 12_000 + 667);
  });
});

describe("Example 9: combo", () => {
  it("UV light + surge protector + membership on one invoice → $185.00", () => {
    const result = evaluateInvoiceSpiffs({
      invoiceId: "INV",
      shares: solo,
      lines: [
        { itemId: "uv", category: "uv_light", qty: 1 },
        { itemId: "surge", category: "surge_protector", qty: 1 },
        { itemId: "mem", category: "membership", qty: 1 },
      ],
    });
    expect(result.awards.map((a) => a.amountCents)).toEqual([5_000, 2_000, 4_000, 7_500]);
    expect(result.totalCents).toBe(18_500);
  });
});

describe("Example 10: split job", () => {
  it("$1,000 GP, 3 h and 1 h → $750 and $250, each at their own week's rate", () => {
    const { credits } = creditJob({
      jobId: "SPLIT",
      gpCents: 100_000,
      techs: [
        { userId: "a", minutes: 180 },
        { userId: "b", minutes: 60 },
      ],
    });
    expect(credits.map((c) => c.creditedGpCents)).toEqual([75_000, 25_000]);
    // Tech A had a Silver week, tech B a Gold week.
    const aWeek = weekCommission([
      { jobId: "SPLIT", creditedGpCents: 75_000 },
      { jobId: "OTHER-A", creditedGpCents: 400_000 },
    ]);
    const bWeek = weekCommission([
      { jobId: "SPLIT", creditedGpCents: 25_000 },
      { jobId: "OTHER-B", creditedGpCents: 600_000 },
    ]);
    expect(aWeek.level.levelName).toBe("Silver");
    expect(bWeek.level.levelName).toBe("Gold");
    expect(aWeek.lines.find((l) => l.jobId === "SPLIT")?.amountCents).toBe(7_500);
    expect(bWeek.lines.find((l) => l.jobId === "SPLIT")?.amountCents).toBe(3_000);
  });
});

describe("Example 11: owner-sold replacement", () => {
  it("lead source tech gets $150.00 when paid in full and no GP credit", () => {
    const credit = creditJob({
      jobId: "REPL",
      gpCents: 450_000,
      sale: { kind: "replacement_sold_by_owner_or_manager", leadSourceUserId: "tech" },
      techs: [{ userId: "installer", minutes: 600 }],
    });
    expect(credit.credits).toEqual([]);
    expect(credit.countsTowardWeekScore).toBe(false);
    const bonus = leadBonus({
      jobId: "REPL",
      leadSourceUserId: credit.leadBonusUserId,
      soldBy: "owner",
      paidInFull: true,
    });
    expect(bonus).toMatchObject({
      eligible: true,
      userId: "tech",
      amountCents: 15_000,
      status: "payable",
    });
  });
});

describe("Example 12: CSR week", () => {
  it("90 bookable, 76 booked → 84.4% → $50.00", () => {
    const result = bookingRateBonus({ userId: "csr", bookableCalls: 90, bookedCalls: 76 });
    expect(result.rateBps).toBe(8_444);
    expect(result.amountCents).toBe(5_000);
  });

  it("25 bookable calls at 92% → $0 (under the 30-call minimum)", () => {
    const result = bookingRateBonus({ userId: "csr", bookableCalls: 25, bookedCalls: 23 });
    expect(result.qualified).toBe(false);
    expect(result.amountCents).toBe(0);
  });
});
