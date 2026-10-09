import { describe, expect, it } from "vitest";
import {
  callbackDeduction,
  capDeduction,
  commissionAtLockedRate,
  costChangeAdjustment,
  DEFAULT_COST_CHANGE_THRESHOLD_CENTS,
  isPaidInFull,
  lineStatusFor,
  membershipRefundDeduction,
  payrollWeekFor,
  refundDeduction,
} from "../src/index";

describe("paid in full", () => {
  it("requires every invoice at a $0 balance", () => {
    expect(isPaidInFull([{ balanceCents: 0 }])).toBe(true);
    expect(isPaidInFull([{ balanceCents: -100 }])).toBe(true); // overpaid
    expect(isPaidInFull([{ balanceCents: 1 }])).toBe(false); // partial payment
    expect(isPaidInFull([{ balanceCents: 0 }, { balanceCents: 5_000 }])).toBe(false);
    expect(isPaidInFull([])).toBe(false);
  });

  it("waits for GreenSky to fund a financed invoice", () => {
    expect(isPaidInFull([{ balanceCents: 0, awaitingFinancing: true }])).toBe(false);
  });

  it("maps to a line status", () => {
    expect(lineStatusFor(false)).toBe("pending_payment");
    expect(lineStatusFor(true)).toBe("payable");
  });

  it("puts a payable line on the run for the week it became payable", () => {
    expect(payrollWeekFor("2026-03-09T03:30:00Z")).toBe("2026-03-02"); // Sunday night local
    expect(payrollWeekFor("2026-03-09T04:00:00Z")).toBe("2026-03-09");
  });
});

describe("commissionAtLockedRate", () => {
  it("refuses an unlocked week", () => {
    expect(() =>
      commissionAtLockedRate({
        jobId: "J1",
        creditedGpCents: 100_000,
        finishedWeek: {
          weekStart: "2026-03-02",
          levelName: "Gold",
          rateBps: 1_200,
          lockedAt: null,
        },
      }),
    ).toThrow(/hasn't locked/);
  });

  it("pays zero on a negative-GP job even at a locked rate", () => {
    const line = commissionAtLockedRate({
      jobId: "J1",
      creditedGpCents: -100,
      finishedWeek: {
        weekStart: "2026-03-02",
        levelName: "Gold",
        rateBps: 1_200,
        lockedAt: "2026-03-09T04:00:00Z",
      },
    });
    expect(line.amountCents).toBe(0);
    expect(line.attributableWeekStart).toBe("2026-03-02");
  });
});

describe("costChangeAdjustment", () => {
  const base = {
    settledCostsCents: 23_000,
    rateBps: 1_200,
    commissionPaidCents: 12_000,
  };

  it("ignores changes of $50 or less", () => {
    expect(DEFAULT_COST_CHANGE_THRESHOLD_CENTS).toBe(5_000);
    const result = costChangeAdjustment({
      ...base,
      currentCostsCents: 28_000,
      newCreditedGpCents: 95_000,
    });
    expect(result.kind).toBe("ignored");
  });

  it("adjusts when costs rise by more than $50", () => {
    const result = costChangeAdjustment({
      ...base,
      currentCostsCents: 28_001,
      newCreditedGpCents: 94_999,
    });
    expect(result).toMatchObject({
      kind: "adjustment",
      newCommissionCents: 11_400,
      amountCents: -600,
    });
  });

  it("adjusts upward when costs fall", () => {
    const result = costChangeAdjustment({
      ...base,
      currentCostsCents: 13_000,
      newCreditedGpCents: 110_000,
    });
    expect(result).toMatchObject({ kind: "adjustment", amountCents: 1_200 });
  });

  it("does nothing when commission was zero and stays zero", () => {
    const result = costChangeAdjustment({
      settledCostsCents: 0,
      currentCostsCents: 10_000,
      newCreditedGpCents: -20_000,
      rateBps: 1_000,
      commissionPaidCents: 0,
    });
    expect(result.kind).toBe("no_change");
  });

  it("uses a custom threshold", () => {
    const result = costChangeAdjustment({
      ...base,
      currentCostsCents: 24_000,
      newCreditedGpCents: 99_000,
      thresholdCents: 500,
    });
    expect(result).toMatchObject({ kind: "adjustment", amountCents: -120 });
  });
});

describe("refundDeduction", () => {
  it("deducts the commission on the refunded amount, rounded once", () => {
    // $333.33 refund × 75% share × 12% = $29.99997 → $30.00
    const result = refundDeduction({
      refundedSaleCents: 33_333,
      shareBps: 7_500,
      rateBps: 1_200,
      commissionPaidCents: 9_000,
    });
    expect(result.amountCents).toBe(-3_000);
  });

  it("never takes back more than was paid", () => {
    const result = refundDeduction({
      refundedSaleCents: 85_000,
      shareBps: 10_000,
      rateBps: 1_000,
      commissionPaidCents: 6_200,
      alreadyDeductedCents: 1_000,
    });
    expect(result.amountCents).toBe(-5_200);
    expect(result.explanation).toContain("capped");
  });
});

describe("callbackDeduction", () => {
  const paid = { status: "paid" as const, amountCents: 6_200 };

  it("deducts at exactly 30 days", () => {
    const result = callbackDeduction({
      originalFinishedOn: "2026-03-02",
      callbackOn: "2026-04-01",
      techCaused: true,
      originalCommission: paid,
    });
    expect(result).toMatchObject({ action: "deduct", amountCents: -6_200 });
  });

  it("does nothing outside 30 days", () => {
    const result = callbackDeduction({
      originalFinishedOn: "2026-03-02",
      callbackOn: "2026-04-02",
      techCaused: true,
      originalCommission: paid,
    });
    expect(result).toMatchObject({ action: "none", reason: "outside_window" });
  });

  it("cancels commission that wasn't paid yet", () => {
    for (const status of ["pending_payment", "payable"] as const) {
      const result = callbackDeduction({
        originalFinishedOn: "2026-03-02",
        callbackOn: "2026-03-05",
        techCaused: true,
        originalCommission: { status, amountCents: 6_200 },
      });
      expect(result.action).toBe("cancel");
    }
  });

  it("waits for the manager's decision", () => {
    const result = callbackDeduction({
      originalFinishedOn: "2026-03-02",
      callbackOn: "2026-03-05",
      techCaused: null,
      originalCommission: paid,
    });
    expect(result).toMatchObject({ action: "none", reason: "awaiting_decision" });
  });

  it("has nothing to take on a $0 line or a canceled line", () => {
    expect(
      callbackDeduction({
        originalFinishedOn: "2026-03-02",
        callbackOn: "2026-03-05",
        techCaused: true,
        originalCommission: { status: "paid", amountCents: 0 },
      }),
    ).toMatchObject({ action: "none", reason: "nothing_to_recover" });
    expect(
      callbackDeduction({
        originalFinishedOn: "2026-03-02",
        callbackOn: "2026-03-05",
        techCaused: true,
        originalCommission: { status: "canceled", amountCents: 6_200 },
      }),
    ).toMatchObject({ action: "none", reason: "already_canceled" });
  });

  it("rejects a callback dated before the original job", () => {
    expect(() =>
      callbackDeduction({
        originalFinishedOn: "2026-03-05",
        callbackOn: "2026-03-02",
        techCaused: true,
        originalCommission: paid,
      }),
    ).toThrow(RangeError);
  });
});

describe("membershipRefundDeduction", () => {
  it("takes back the spiff within 30 days", () => {
    expect(
      membershipRefundDeduction({
        soldOn: "2026-03-02",
        refundedOn: "2026-03-20",
        originalSpiff: { status: "paid", amountCents: 4_000 },
      }),
    ).toMatchObject({ action: "deduct", amountCents: -4_000 });
    expect(
      membershipRefundDeduction({
        soldOn: "2026-03-02",
        refundedOn: "2026-04-10",
        originalSpiff: { status: "paid", amountCents: 4_000 },
      }),
    ).toMatchObject({ action: "none", reason: "outside_window" });
  });
});

describe("capDeduction", () => {
  it("takes everything when pay covers it", () => {
    const result = capDeduction({
      owedCents: 6_200,
      nonOvertimePayCents: 84_000,
      nonOvertimeMinutes: 2_400,
      minimumWageCentsPerHour: 725,
    });
    expect(result).toMatchObject({ takenCents: 6_200, carryForwardCents: 0, floorCents: 29_000 });
  });

  it("never takes pay below minimum wage and carries the rest forward", () => {
    // 10 hours at $7.25 minimum = $72.50 floor; pay $100.00 → only $27.50 can be taken.
    const result = capDeduction({
      owedCents: 6_200,
      nonOvertimePayCents: 10_000,
      nonOvertimeMinutes: 600,
      minimumWageCentsPerHour: 725,
    });
    expect(result).toMatchObject({
      floorCents: 7_250,
      availableCents: 2_750,
      takenCents: 2_750,
      carryForwardCents: 3_450,
    });
    expect(result.explanation).toContain("carries forward");
  });

  it("rounds the floor up in the employee's favor", () => {
    // 1 minute at $7.25/hr = 12.08 cents → floor 13 cents.
    const result = capDeduction({
      owedCents: 100,
      nonOvertimePayCents: 100,
      nonOvertimeMinutes: 1,
      minimumWageCentsPerHour: 725,
    });
    expect(result.floorCents).toBe(13);
    expect(result.takenCents).toBe(87);
  });

  it("takes nothing when pay is already at the floor", () => {
    const result = capDeduction({
      owedCents: 500,
      nonOvertimePayCents: 7_250,
      nonOvertimeMinutes: 600,
      minimumWageCentsPerHour: 725,
    });
    expect(result).toMatchObject({ takenCents: 0, carryForwardCents: 500 });
  });
});
