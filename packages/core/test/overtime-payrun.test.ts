import { describe, expect, it } from "vitest";
import {
  assemblePayRun,
  explainOtAdjustment,
  otAdjustment,
  otTrueUp,
  overtimeMinutes,
  type PayRunInput,
} from "../src/index";

describe("overtime", () => {
  it("overtime is time over 40 hours", () => {
    expect(overtimeMinutes(2_400)).toBe(0);
    expect(overtimeMinutes(2_401)).toBe(1);
    expect(overtimeMinutes(2_700)).toBe(300);
  });

  it("otAdjustment = half-up(C × OT ÷ (2 × total))", () => {
    expect(otAdjustment(12_000, 2_700, 300)).toBe(667);
    expect(otAdjustment(51_000, 2_700, 300)).toBe(2_833); // 2833.33
    expect(otAdjustment(9, 4, 1)).toBe(1); // 1.125 → 1
    expect(otAdjustment(12, 4, 1)).toBe(2); // 1.5 → 2
    expect(otAdjustment(12_000, 2_400, 0)).toBe(0);
    expect(otAdjustment(0, 0, 0)).toBe(0);
    expect(() => otAdjustment(100, 60, 61)).toThrow(RangeError);
    expect(explainOtAdjustment(12_000, 2_700, 300, "2026-03-02")).toContain("= $6.67");
  });

  it("true-ups pay the difference of recomputed adjustments", () => {
    // Week had $500 attributed and $27.78 paid; $120 more arrives late.
    const result = otTrueUp({
      weekStart: "2026-03-02",
      totalMinutes: 2_700,
      otMinutes: 300,
      previouslyAttributedCents: 50_000,
      newlyAttributedCents: 12_000,
      adjustmentAlreadyPaidCents: 2_778,
    });
    expect(result.recomputedAdjustmentCents).toBe(3_444); // 3444.44
    expect(result.amountCents).toBe(666);
  });

  it("no true-up without overtime", () => {
    const result = otTrueUp({
      weekStart: "2026-03-02",
      totalMinutes: 2_000,
      otMinutes: 0,
      previouslyAttributedCents: 0,
      newlyAttributedCents: 12_000,
      adjustmentAlreadyPaidCents: 0,
    });
    expect(result.amountCents).toBe(0);
  });
});

const week = "2026-03-09";
const base: PayRunInput = {
  mode: "live",
  weekStart: week,
  minimumWageCentsPerHour: 725,
  employees: [{ userId: "tech-a", name: "Ann", wageCentsPerHour: 2_100, totalMinutes: 2_700 }],
  lines: [],
};

describe("assemblePayRun", () => {
  it("computes hourly, overtime pay and the overtime adjustment for this week", () => {
    const run = assemblePayRun({
      ...base,
      lines: [
        {
          userId: "tech-a",
          kind: "commission",
          amountCents: 51_000,
          explanation: "Week commission",
          attributableWeekStart: week,
        },
      ],
    });
    const sheet = run.sheets[0];
    expect(sheet).toMatchObject({
      regularMinutes: 2_400,
      overtimeMinutes: 300,
      hourlyCents: 84_000 + 15_750,
      commissionCents: 51_000,
      otAdjustmentCents: 2_833,
      totalCents: 84_000 + 15_750 + 51_000 + 2_833,
    });
    expect(sheet?.lines.map((l) => l.kind)).toEqual([
      "hourly_regular",
      "hourly_overtime",
      "commission",
      "ot_adjustment",
    ]);
    expect(sheet?.lines[1]?.explanation).toBe(
      "5h overtime (over 40h) × 1.5 × $21.00/hr = $157.50.",
    );
    expect(sheet?.overtimeWeeks).toEqual([
      {
        weekStart: week,
        totalMinutes: 2_700,
        otMinutes: 300,
        attributedCents: 51_000,
        adjustmentPaidCents: 2_833,
      },
    ]);
    expect(run.totalCents).toBe(sheet?.totalCents);
  });

  it("every sheet total is the sum of its lines", () => {
    const run = assemblePayRun({
      ...base,
      carriedIn: [{ userId: "tech-a", amountCents: 1_000 }],
      lines: [
        {
          userId: "tech-a",
          kind: "commission",
          amountCents: 3_333,
          explanation: "c",
          attributableWeekStart: week,
        },
        {
          userId: "tech-a",
          kind: "spiff",
          amountCents: 5_000,
          explanation: "s",
          attributableWeekStart: week,
        },
        {
          userId: "tech-a",
          kind: "combo",
          amountCents: 7_500,
          explanation: "k",
          attributableWeekStart: week,
        },
        {
          userId: "tech-a",
          kind: "cost_adjustment",
          amountCents: -600,
          explanation: "a",
          attributableWeekStart: "2026-03-02",
        },
        { userId: "tech-a", kind: "callback_deduction", amountCents: -6_200, explanation: "d" },
      ],
      priorWeeks: [
        {
          userId: "tech-a",
          weekStart: "2026-03-02",
          totalMinutes: 2_400,
          otMinutes: 0,
          attributedCents: 60_000,
          adjustmentPaidCents: 0,
        },
      ],
    });
    const sheet = run.sheets[0];
    if (!sheet) throw new Error("missing sheet");
    expect(sheet.totalCents).toBe(sheet.lines.reduce((sum, line) => sum + line.amountCents, 0));
    expect(sheet.totalCents).toBe(
      sheet.hourlyCents +
        sheet.commissionCents +
        sheet.spiffsCents +
        sheet.deductionsCents +
        sheet.otAdjustmentCents,
    );
    expect(sheet.deductionsCents).toBe(-7_200);
    expect(sheet.lines.every((line) => line.explanation.length > 0)).toBe(true);
  });

  it("caps deductions at minimum wage and carries the rest forward", () => {
    const run = assemblePayRun({
      ...base,
      employees: [{ userId: "tech-a", wageCentsPerHour: 1_000, totalMinutes: 600 }],
      lines: [
        {
          userId: "tech-a",
          kind: "callback_deduction",
          amountCents: -6_200,
          explanation: "Callback",
        },
      ],
    });
    const sheet = run.sheets[0];
    // Pay $100.00 for 10 hours; the $72.50 minimum-wage floor leaves $27.50 to take.
    expect(sheet?.carryForwardCents).toBe(3_450);
    expect(sheet?.deductionsCents).toBe(-2_750);
    expect(sheet?.totalCents).toBe(7_250);
    expect(sheet?.lines.find((l) => l.kind === "deduction_carry_forward")).toMatchObject({
      amountCents: 3_450,
    });
    expect(sheet?.explanation).toContain("carries to the next run");
  });

  it("never takes deductions from overtime pay", () => {
    const run = assemblePayRun({
      ...base,
      employees: [{ userId: "tech-a", wageCentsPerHour: 725, totalMinutes: 2_700 }],
      lines: [
        { userId: "tech-a", kind: "callback_deduction", amountCents: -500, explanation: "x" },
      ],
    });
    const sheet = run.sheets[0];
    // Regular pay is exactly minimum wage, so nothing can be taken; overtime pay is untouched.
    expect(sheet?.carryForwardCents).toBe(500);
    expect(sheet?.totalCents).toBe(sheet?.hourlyCents);
  });

  it("true-ups a late line against an earlier overtime week (Example 8 shape)", () => {
    const run = assemblePayRun({
      ...base,
      employees: [{ userId: "tech-a", wageCentsPerHour: 2_100, totalMinutes: 2_400 }],
      priorWeeks: [
        {
          userId: "tech-a",
          weekStart: "2026-02-02",
          totalMinutes: 2_700,
          otMinutes: 300,
          attributedCents: 50_000,
          adjustmentPaidCents: 2_778,
        },
      ],
      lines: [
        {
          userId: "tech-a",
          kind: "commission",
          amountCents: 12_000,
          explanation: "Late commercial job",
          attributableWeekStart: "2026-02-02",
        },
      ],
    });
    const sheet = run.sheets[0];
    expect(sheet?.lines.find((l) => l.kind === "ot_true_up")).toMatchObject({ amountCents: 666 });
    expect(sheet?.overtimeWeeks.find((w) => w.weekStart === "2026-02-02")).toMatchObject({
      attributedCents: 62_000,
      adjustmentPaidCents: 3_444,
    });
  });

  it("labels practice runs", () => {
    const run = assemblePayRun({ ...base, mode: "practice" });
    expect(run.sheets[0]?.explanation.startsWith("PRACTICE ONLY, not paid.")).toBe(true);
    expect(run.mode).toBe("practice");
  });

  it("refuses unsafe input", () => {
    const line = {
      userId: "tech-a",
      kind: "commission" as const,
      amountCents: 100,
      explanation: "x",
      attributableWeekStart: week,
    };
    expect(() => assemblePayRun({ ...base, weekStart: "2026-03-10" })).toThrow(/Monday/);
    expect(() => assemblePayRun({ ...base, lines: [{ ...line, userId: "ghost" }] })).toThrow(
      /no hours/,
    );
    expect(() =>
      assemblePayRun({ ...base, lines: [{ ...line, attributableWeekStart: undefined }] }),
    ).toThrow(/attributable/);
    expect(() =>
      assemblePayRun({ ...base, lines: [{ ...line, attributableWeekStart: "2026-03-16" }] }),
    ).toThrow(/after this run/);
    expect(() => assemblePayRun({ ...base, lines: [{ ...line, amountCents: -1 }] })).toThrow(
      /negative/,
    );
    expect(() =>
      assemblePayRun({
        ...base,
        lines: [{ userId: "tech-a", kind: "refund_deduction", amountCents: 5, explanation: "x" }],
      }),
    ).toThrow(/positive/);
    expect(() =>
      assemblePayRun({ ...base, lines: [{ ...line, kind: "ot_true_up" as never }] }),
    ).toThrow(/computed/);
    expect(() =>
      assemblePayRun({ ...base, lines: [{ ...line, attributableWeekStart: "2026-03-02" }] }),
    ).toThrow(/overtime history/);
    expect(() => assemblePayRun({ ...base, lines: [{ ...line, amountCents: 1.5 }] })).toThrow(
      RangeError,
    );
    expect(() =>
      assemblePayRun({ ...base, employees: [...base.employees, ...base.employees] }),
    ).toThrow(/twice/);
  });

  it("handles several employees independently", () => {
    const run = assemblePayRun({
      ...base,
      employees: [
        { userId: "tech-a", wageCentsPerHour: 2_100, totalMinutes: 2_400 },
        { userId: "csr-1", wageCentsPerHour: 1_800, totalMinutes: 2_400 },
      ],
      lines: [
        {
          userId: "csr-1",
          kind: "booking_rate",
          amountCents: 5_000,
          explanation: "84.44%",
          attributableWeekStart: week,
        },
        {
          userId: "csr-1",
          kind: "booking",
          amountCents: 500,
          explanation: "Booked J1",
          attributableWeekStart: week,
        },
      ],
    });
    expect(run.sheets.map((s) => [s.userId, s.totalCents])).toEqual([
      ["tech-a", 84_000],
      ["csr-1", 72_000 + 5_500],
    ]);
    expect(run.totalCents).toBe(84_000 + 77_500);
  });
});
