/**
 * Spec tests for docs/02-commission-plan.md section 5: when commission is paid.
 * Calendar used here: week 1 starts Monday 2026-10-05, week 6 starts Monday 2026-11-09.
 */
import { describe, expect, it } from "vitest";
import {
  commissionAtLockedRate,
  costChangeAdjustment,
  DEFAULT_COST_CHANGE_THRESHOLD_CENTS,
  isPaidInFull,
  lineStatusFor,
  payrollWeekFor,
  refundDeduction,
  weekLocksAt,
} from "../../src/index";

const WEEK_1 = "2026-10-05";
const WEEK_6 = "2026-11-09";

const goldWeek1 = {
  weekStart: WEEK_1,
  levelName: "Gold",
  rateBps: 1_200,
  lockedAt: weekLocksAt(WEEK_1),
};

describe("A commission line becomes payable when the job is paid in full", () => {
  it("partial payments pay nothing until the balance is $0", () => {
    expect(lineStatusFor(isPaidInFull([{ balanceCents: 50_000 }]))).toBe("pending_payment");
    expect(lineStatusFor(isPaidInFull([{ balanceCents: 1 }]))).toBe("pending_payment");
    expect(lineStatusFor(isPaidInFull([{ balanceCents: 0 }]))).toBe("payable");
  });

  it("a financed job is payable only once GreenSky funds", () => {
    expect(lineStatusFor(isPaidInFull([{ balanceCents: 0, awaitingFinancing: true }]))).toBe(
      "pending_payment",
    );
  });
});

describe("Payable lines go on the next weekly payroll run after they become payable", () => {
  it.each([
    ["2026-11-09T05:00:00Z", WEEK_6], // Monday 00:00 EST
    ["2026-11-12T15:00:00Z", WEEK_6],
    ["2026-11-15T23:59:59-05:00", WEEK_6], // Sunday 23:59:59 local
    ["2026-11-16T05:00:00Z", "2026-11-16"], // next Monday 00:00 local
    ["2026-11-09T04:59:59Z", "2026-11-02"], // still Sunday night of week 5
  ])("paid at %s → run for the week of %s", (paidAt, run) => {
    expect(payrollWeekFor(paidAt)).toBe(run);
  });
});

describe("…at the rate locked for the week the job was finished", () => {
  it("a job finished in a Gold week 1 and paid in week 6 pays 12%", () => {
    const line = commissionAtLockedRate({
      jobId: "COMM-1",
      creditedGpCents: 100_000,
      finishedWeek: goldWeek1,
    });
    expect(line.amountCents).toBe(12_000);
    expect(line.rateBps).toBe(1_200);
    expect(line.levelName).toBe("Gold");
    expect(line.attributableWeekStart).toBe(WEEK_1);
    expect(line.explanation).toContain(WEEK_1);
  });

  it("a negative credited GP still makes a $0 line at the locked rate", () => {
    const line = commissionAtLockedRate({
      jobId: "COMM-2",
      creditedGpCents: -40_000,
      finishedWeek: goldWeek1,
    });
    expect(line.amountCents).toBe(0);
  });
});

describe("Cost changes after commission was paid: more than $50 → adjustment line", () => {
  // Example 1's job: GP $620 at Silver (10%), $62.00 paid. Costs at payment: $230.
  const base = { settledCostsCents: 23_000, rateBps: 1_000, commissionPaidCents: 6_200 };

  it("the threshold starts at $50", () => {
    expect(DEFAULT_COST_CHANGE_THRESHOLD_CENTS).toBe(5_000);
  });

  it("a late $80 supplier bill → GP $540 → commission $54 → adjustment −$8.00", () => {
    const result = costChangeAdjustment({
      ...base,
      currentCostsCents: 31_000,
      newCreditedGpCents: 54_000,
    });
    expect(result.kind).toBe("adjustment");
    if (result.kind !== "adjustment") return;
    expect(result.amountCents).toBe(-800);
    expect(result.newCommissionCents).toBe(5_400);
    expect(result.costChangeCents).toBe(8_000);
  });

  it("costs falling by $60 → positive adjustment +$6.00", () => {
    const result = costChangeAdjustment({
      ...base,
      currentCostsCents: 17_000,
      newCreditedGpCents: 68_000,
    });
    expect(result.kind).toBe("adjustment");
    if (result.kind !== "adjustment") return;
    expect(result.amountCents).toBe(600);
  });

  it.each([
    [5_000, "ignored"],
    [-5_000, "ignored"],
    [4_999, "ignored"],
    [1, "ignored"],
    [0, "ignored"],
    [5_001, "adjustment"],
    [-5_001, "adjustment"],
  ])("a change of %i cents is %s (exactly $50 is not more than $50)", (change, kind) => {
    const result = costChangeAdjustment({
      ...base,
      currentCostsCents: 23_000 + change,
      newCreditedGpCents: 62_000 - change,
    });
    expect(result.kind).toBe(kind);
  });

  it("$50.01 more cost → GP $569.99 → $57.00 (half-up) → −$5.00", () => {
    const result = costChangeAdjustment({
      ...base,
      currentCostsCents: 28_001,
      newCreditedGpCents: 56_999,
    });
    expect(result.kind === "adjustment" && result.amountCents).toBe(-500);
  });

  it("the threshold is a setting", () => {
    const ignored = costChangeAdjustment({
      ...base,
      currentCostsCents: 31_000,
      newCreditedGpCents: 54_000,
      thresholdCents: 10_000,
    });
    expect(ignored.kind).toBe("ignored");
  });

  it("the threshold applies to the job's cost change, not the tech's share of it", () => {
    // Split job: $1,000 GP, this tech has 25% at Gold. Costs rise $100 (the tech's share: $25).
    const result = costChangeAdjustment({
      settledCostsCents: 50_000,
      currentCostsCents: 60_000,
      newCreditedGpCents: 22_500,
      rateBps: 1_200,
      commissionPaidCents: 3_000,
    });
    expect(result.kind).toBe("adjustment");
    if (result.kind !== "adjustment") return;
    expect(result.amountCents).toBe(-300);
  });

  it("if the new GP goes negative, the adjustment takes back exactly what was paid", () => {
    const result = costChangeAdjustment({
      ...base,
      currentCostsCents: 100_000,
      newCreditedGpCents: -15_000,
    });
    expect(result.kind === "adjustment" && result.amountCents).toBe(-6_200);
  });

  it("a big cost change that doesn't move the rounded commission makes no line", () => {
    // At 0.01%: GP 62_000 → 6.2¢ → 6¢; GP 61_996 → 6.1996¢ → 6¢. Unchanged.
    const result = costChangeAdjustment({
      settledCostsCents: 23_000,
      currentCostsCents: 29_000,
      newCreditedGpCents: 61_996,
      rateBps: 1,
      commissionPaidCents: 6,
    });
    expect(result.kind).not.toBe("adjustment");
  });
});

describe("Refunds and chargebacks after payment: deduction for the commission on the refund", () => {
  it("$100 refunded on a 10% job the tech had alone → −$10.00", () => {
    const result = refundDeduction({
      refundedSaleCents: 10_000,
      shareBps: 10_000,
      rateBps: 1_000,
      commissionPaidCents: 6_200,
    });
    expect(result.amountCents).toBe(-1_000);
  });

  it("only the tech's share of the refund counts", () => {
    const result = refundDeduction({
      refundedSaleCents: 10_000,
      shareBps: 5_000,
      rateBps: 1_000,
      commissionPaidCents: 3_100,
    });
    expect(result.amountCents).toBe(-500);
  });

  it("rounds half-up to the cent", () => {
    const at = (refund: number) =>
      refundDeduction({
        refundedSaleCents: refund,
        shareBps: 10_000,
        rateBps: 500,
        commissionPaidCents: 100_000,
      }).amountCents;
    expect(at(12_345)).toBe(-617); // 617.25
    expect(at(12_350)).toBe(-618); // 617.5
  });

  it("never takes back more commission than was paid on the job", () => {
    // A full $850 refund on example 1's job: 10% of $850 is $85, but only $62 was paid.
    const result = refundDeduction({
      refundedSaleCents: 85_000,
      shareBps: 10_000,
      rateBps: 1_000,
      commissionPaidCents: 6_200,
    });
    expect(result.amountCents).toBe(-6_200);
    const second = refundDeduction({
      refundedSaleCents: 10_000,
      shareBps: 10_000,
      rateBps: 1_000,
      commissionPaidCents: 6_200,
      alreadyDeductedCents: 6_200,
    });
    expect(second.amountCents).toBe(0);
  });
});
