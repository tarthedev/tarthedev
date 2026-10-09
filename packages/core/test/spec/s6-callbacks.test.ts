/**
 * Spec tests for docs/02-commission-plan.md section 6: callbacks (the 30-day "oops rule")
 * and deductions under NC G.S. 95-25.8 (never below minimum wage, never touching overtime
 * wages, the rest carries forward). Membership refunds (section 7) use the same clawback.
 */
import { describe, expect, it } from "vitest";
import {
  assemblePayRun,
  callbackDeduction,
  capDeduction,
  DEFAULT_CALLBACK_WINDOW_DAYS,
  membershipRefundDeduction,
} from "../../src/index";

const paid62 = { status: "paid" as const, amountCents: 6_200 };

describe("Callback window: within 30 days of the original job's finish date", () => {
  it("the window starts at 30 days", () => {
    expect(DEFAULT_CALLBACK_WINDOW_DAYS).toBe(30);
  });

  it.each([
    ["2026-10-06", "deduct"], // same day
    ["2026-10-20", "deduct"], // two weeks later
    ["2026-11-05", "deduct"], // day 30
    ["2026-11-06", "none"], // day 31
  ])("callback on %s after a job finished 2026-10-06 → %s", (callbackOn, action) => {
    const decision = callbackDeduction({
      originalFinishedOn: "2026-10-06",
      callbackOn,
      techCaused: true,
      originalCommission: paid62,
    });
    expect(decision.action).toBe(action);
  });

  it("a callback can't come before the original job was finished", () => {
    expect(() =>
      callbackDeduction({
        originalFinishedOn: "2026-10-06",
        callbackOn: "2026-10-05",
        techCaused: true,
        originalCommission: paid62,
      }),
    ).toThrow();
  });
});

describe("Tech-caused vs not tech-caused", () => {
  it("tech-caused, commission paid → deduction equal to the commission", () => {
    const decision = callbackDeduction({
      originalFinishedOn: "2026-10-06",
      callbackOn: "2026-10-20",
      techCaused: true,
      reason: "Missed a loose wire",
      originalCommission: paid62,
    });
    expect(decision).toMatchObject({ action: "deduct", amountCents: -6_200 });
    expect(decision.explanation).toContain("Missed a loose wire");
  });

  it("tech-caused on a split job → only the original tech's share", () => {
    const decision = callbackDeduction({
      originalFinishedOn: "2026-10-06",
      callbackOn: "2026-10-20",
      techCaused: true,
      originalCommission: { status: "paid", amountCents: 4_650 },
    });
    expect(decision).toMatchObject({ action: "deduct", amountCents: -4_650 });
  });

  it.each(["pending_payment", "payable"] as const)(
    "tech-caused, commission not paid yet (%s) → cancelled instead",
    (status) => {
      const decision = callbackDeduction({
        originalFinishedOn: "2026-10-06",
        callbackOn: "2026-10-20",
        techCaused: true,
        originalCommission: { status, amountCents: 6_200 },
      });
      expect(decision.action).toBe("cancel");
    },
  );

  it("not tech-caused → no deduction, and the tech sees the reason", () => {
    const decision = callbackDeduction({
      originalFinishedOn: "2026-10-06",
      callbackOn: "2026-10-20",
      techCaused: false,
      reason: "Part failed from factory",
      originalCommission: paid62,
    });
    expect(decision).toMatchObject({ action: "none", reason: "not_tech_caused" });
    expect(decision.explanation).toContain("Part failed from factory");
  });

  it("no decision yet → nothing happens yet", () => {
    const decision = callbackDeduction({
      originalFinishedOn: "2026-10-06",
      callbackOn: "2026-10-20",
      techCaused: null,
      originalCommission: paid62,
    });
    expect(decision.action).toBe("none");
  });

  it("a $0 commission (negative-GP job) has nothing to deduct", () => {
    const decision = callbackDeduction({
      originalFinishedOn: "2026-10-06",
      callbackOn: "2026-10-20",
      techCaused: true,
      originalCommission: { status: "paid", amountCents: 0 },
    });
    expect(decision.action).toBe("none");
  });
});

describe("A membership refunded within 30 days creates a deduction line", () => {
  const spiff = { status: "paid" as const, amountCents: 4_000 };

  it.each([
    ["2026-10-01", "deduct"],
    ["2026-10-31", "deduct"], // day 30
    ["2026-11-01", "none"], // day 31
  ])("sold 2026-10-01, refunded %s → %s", (refundedOn, action) => {
    const decision = membershipRefundDeduction({
      soldOn: "2026-10-01",
      refundedOn,
      originalSpiff: spiff,
    });
    expect(decision.action).toBe(action);
    if (decision.action === "deduct") expect(decision.amountCents).toBe(-4_000);
  });

  it("an unpaid membership spiff is cancelled instead", () => {
    const decision = membershipRefundDeduction({
      soldOn: "2026-10-01",
      refundedOn: "2026-10-05",
      originalSpiff: { status: "pending_payment", amountCents: 4_000 },
    });
    expect(decision.action).toBe("cancel");
  });
});

describe("Deductions never take pay below minimum wage; the rest carries forward", () => {
  it("takes everything when pay is well above the floor", () => {
    const cap = capDeduction({
      owedCents: 6_200,
      nonOvertimePayCents: 84_000,
      nonOvertimeMinutes: 2_400,
      minimumWageCentsPerHour: 725,
    });
    expect(cap).toMatchObject({ takenCents: 6_200, carryForwardCents: 0, floorCents: 29_000 });
  });

  it("40 h at $8.00 with $62 owed: $30 taken (down to $290 = 40 × $7.25), $32 carries", () => {
    const cap = capDeduction({
      owedCents: 6_200,
      nonOvertimePayCents: 32_000,
      nonOvertimeMinutes: 2_400,
      minimumWageCentsPerHour: 725,
    });
    expect(cap).toMatchObject({
      takenCents: 3_000,
      carryForwardCents: 3_200,
      availableCents: 3_000,
      floorCents: 29_000,
    });
    expect(cap.takenCents + cap.carryForwardCents).toBe(6_200);
  });

  it("takes nothing when pay is already at or below the floor", () => {
    const cap = capDeduction({
      owedCents: 6_200,
      nonOvertimePayCents: 29_000,
      nonOvertimeMinutes: 2_400,
      minimumWageCentsPerHour: 725,
    });
    expect(cap).toMatchObject({ takenCents: 0, carryForwardCents: 6_200 });
  });

  it("rounds the minimum-wage floor up, in the employee's favor", () => {
    // 1 minute × $7.25/hr = 12.08¢ → floor 13¢.
    const cap = capDeduction({
      owedCents: 100,
      nonOvertimePayCents: 100,
      nonOvertimeMinutes: 1,
      minimumWageCentsPerHour: 725,
    });
    expect(cap.floorCents).toBe(13);
    expect(cap.takenCents).toBe(87);
  });

  it("in a pay run, overtime wages are never touched and the rest carries forward", () => {
    // 45 h at $7.50: regular $300.00, overtime 5 h × $11.25 = $56.25. Callback deduction −$62.
    const run = assemblePayRun({
      mode: "live",
      weekStart: "2026-10-19",
      minimumWageCentsPerHour: 725,
      employees: [{ userId: "tech", wageCentsPerHour: 750, totalMinutes: 2_700 }],
      lines: [
        {
          userId: "tech",
          kind: "callback_deduction",
          amountCents: -6_200,
          explanation: "Tech-caused callback on job J1",
        },
      ],
    });
    const sheet = run.sheets[0];
    expect(sheet?.hourlyCents).toBe(30_000 + 5_625);
    // Only $10.00 can come out of the $300.00 regular pay (floor $290.00).
    expect(sheet?.deductionsCents).toBe(-1_000);
    expect(sheet?.carryForwardCents).toBe(5_200);
    expect(sheet?.totalCents).toBe(29_000 + 5_625);
    expect(sheet?.totalCents).toBe(sheet?.lines.reduce((sum, line) => sum + line.amountCents, 0));
  });

  it("a carried-forward amount is taken in the next run when pay allows", () => {
    const run = assemblePayRun({
      mode: "live",
      weekStart: "2026-10-26",
      minimumWageCentsPerHour: 725,
      employees: [{ userId: "tech", wageCentsPerHour: 750, totalMinutes: 2_400 }],
      carriedIn: [{ userId: "tech", amountCents: 5_200 }],
      lines: [
        {
          userId: "tech",
          kind: "commission",
          amountCents: 10_000,
          attributableWeekStart: "2026-10-26",
          explanation: "Job J7",
        },
      ],
    });
    const sheet = run.sheets[0];
    expect(sheet?.carryForwardCents).toBe(0);
    expect(sheet?.deductionsCents).toBe(-5_200);
    expect(sheet?.totalCents).toBe(30_000 + 10_000 - 5_200);
  });

  describe("negative adjustments can't take pay below minimum wage either", () => {
    // A late $8 supplier bill cuts commission on a job from an earlier overtime week (45 h),
    // which also lowers that week's overtime adjustment: 0.5 × $832 ÷ 45 × 5 = $46.22,
    // $46.67 already paid → a −$0.45 true-up.
    const runFor = (wageCentsPerHour: number) =>
      assemblePayRun({
        mode: "live",
        weekStart: "2026-11-09",
        minimumWageCentsPerHour: 725,
        employees: [{ userId: "tech", wageCentsPerHour, totalMinutes: 2_400 }],
        lines: [
          {
            userId: "tech",
            kind: "cost_adjustment",
            amountCents: -800,
            attributableWeekStart: "2026-10-05",
            explanation: "Late supplier bill on job J1",
          },
        ],
        priorWeeks: [
          {
            userId: "tech",
            weekStart: "2026-10-05",
            totalMinutes: 2_700,
            otMinutes: 300,
            attributedCents: 84_000,
            adjustmentPaidCents: 4_667,
          },
        ],
      }).sheets[0];

    it("at minimum wage nothing is taken; the $8.45 carries forward", () => {
      const sheet = runFor(725);
      expect(sheet?.lines.find((line) => line.kind === "ot_true_up")?.amountCents).toBe(-45);
      // 40 h × $7.25 = $290.00 is the floor; the sheet never pays less.
      expect(sheet?.totalCents).toBe(29_000);
      expect(sheet?.carryForwardCents).toBe(845);
      expect(sheet?.totalCents).toBe(sheet?.lines.reduce((sum, line) => sum + line.amountCents, 0));
    });

    it("with room above the floor, all of it is taken this run", () => {
      const sheet = runFor(2_100);
      expect(sheet?.carryForwardCents).toBe(0);
      expect(sheet?.totalCents).toBe(84_000 - 800 - 45);
    });
  });
});
