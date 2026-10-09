/**
 * Spec tests for docs/02-commission-plan.md section 9: the weekly payroll sheet and the
 * overtime regular-rate adjustment, plus 9a (practice mode before rollout).
 *
 *   adjustment(W) = 0.5 × (commission + spiffs attributable to W) ÷ total hours in W × OT hours in W
 */
import { describe, expect, it } from "vitest";
import {
  assemblePayRun,
  DEFAULT_OVERTIME_THRESHOLD_MINUTES,
  otAdjustment,
  otTrueUp,
  overtimeMinutes,
  type PaySheet,
  type RunLine,
} from "../../src/index";

const WEEK_1 = "2026-10-05";
const WEEK_6 = "2026-11-09";
const MIN_WAGE = 725;

function only(sheets: PaySheet[]): PaySheet {
  const [sheet] = sheets;
  if (!sheet || sheets.length !== 1) throw new Error("expected exactly one sheet");
  return sheet;
}

function line(kind: RunLine["kind"], amountCents: number, week?: string, userId = "tech"): RunLine {
  return {
    userId,
    kind,
    amountCents,
    explanation: `${kind} line`,
    ...(week ? { attributableWeekStart: week } : {}),
  };
}

function linesOf(sheet: PaySheet, kind: string) {
  return sheet.lines.filter((l) => l.kind === kind);
}

describe("Overtime hours: over 40 in the pay week", () => {
  it.each([
    [0, 0],
    [2_400, 0], // exactly 40 h
    [2_401, 1],
    [2_700, 300],
    [3_000, 600],
  ])("%i minutes worked → %i overtime minutes", (total, ot) => {
    expect(overtimeMinutes(total)).toBe(ot);
  });

  it("the threshold starts at 40 hours", () => {
    expect(DEFAULT_OVERTIME_THRESHOLD_MINUTES).toBe(2_400);
  });
});

describe("Overtime regular-rate adjustment formula", () => {
  it("0.5 × $120 ÷ 45 h × 5 h = $6.67 (example 8)", () => {
    expect(otAdjustment(12_000, 2_700, 300)).toBe(667);
  });

  it("0.5 × $845 ÷ 45 h × 5 h = $46.94", () => {
    expect(otAdjustment(84_500, 2_700, 300)).toBe(4_694);
  });

  it("rounds half-up: 0.5 × $0.09 ÷ 45 h × 5 h = 0.5¢ → 1¢", () => {
    expect(otAdjustment(9, 2_700, 300)).toBe(1);
  });

  it("no overtime → no adjustment", () => {
    expect(otAdjustment(100_000, 2_400, 0)).toBe(0);
  });

  it("recomputes the earlier week and pays only the difference as a true-up", () => {
    const first = otTrueUp({
      weekStart: WEEK_1,
      totalMinutes: 2_700,
      otMinutes: 300,
      previouslyAttributedCents: 0,
      newlyAttributedCents: 12_000,
      adjustmentAlreadyPaidCents: 0,
    });
    expect(first.amountCents).toBe(667);

    const withHistory = otTrueUp({
      weekStart: WEEK_1,
      totalMinutes: 2_700,
      otMinutes: 300,
      previouslyAttributedCents: 72_000,
      newlyAttributedCents: 12_000,
      adjustmentAlreadyPaidCents: 4_000,
    });
    expect(withHistory.recomputedAdjustmentCents).toBe(4_667);
    expect(withHistory.amountCents).toBe(667);
  });
});

describe("Weekly payroll sheet", () => {
  it("example 2's week at 45 hours: hourly, OT at 1.5×, commission, spiffs and OT adjustment", () => {
    const run = assemblePayRun({
      mode: "live",
      weekStart: WEEK_1,
      minimumWageCentsPerHour: MIN_WAGE,
      employees: [{ userId: "tech", wageCentsPerHour: 2_100, totalMinutes: 2_700 }],
      lines: [
        line("commission", 51_000, WEEK_1),
        line("spiff", 26_000, WEEK_1),
        line("combo", 7_500, WEEK_1),
      ],
    });
    const sheet = only(run.sheets);
    expect(sheet.regularMinutes).toBe(2_400);
    expect(sheet.overtimeMinutes).toBe(300);
    expect(linesOf(sheet, "hourly_regular")[0]?.amountCents).toBe(84_000);
    expect(linesOf(sheet, "hourly_overtime")[0]?.amountCents).toBe(15_750); // 5 h × $31.50
    expect(sheet.commissionCents).toBe(51_000);
    expect(sheet.spiffsCents).toBe(33_500);
    expect(sheet.otAdjustmentCents).toBe(4_694);
    expect(sheet.totalCents).toBe(84_000 + 15_750 + 51_000 + 33_500 + 4_694);
  });

  it("a late payment adds a true-up for the finished week, not the run week", () => {
    // Week 6 run: tech worked 50 h in week 6; week 1 was 45 h.
    const run = assemblePayRun({
      mode: "live",
      weekStart: WEEK_6,
      minimumWageCentsPerHour: MIN_WAGE,
      employees: [{ userId: "tech", wageCentsPerHour: 2_100, totalMinutes: 3_000 }],
      lines: [line("commission", 20_000, WEEK_6), line("commission", 12_000, WEEK_1)],
      priorWeeks: [
        {
          userId: "tech",
          weekStart: WEEK_1,
          totalMinutes: 2_700,
          otMinutes: 300,
          attributedCents: 72_000,
          adjustmentPaidCents: 4_000,
        },
      ],
    });
    const sheet = only(run.sheets);
    // Week 6's own adjustment only counts week 6's commission: 0.5 × $200 ÷ 50 × 10 = $20.
    expect(
      linesOf(sheet, "ot_adjustment").map((l) => [l.attributableWeekStart, l.amountCents]),
    ).toEqual([[WEEK_6, 2_000]]);
    // Week 1 recomputed: 0.5 × $840 ÷ 45 × 5 = $46.67, minus $40.00 already paid.
    expect(
      linesOf(sheet, "ot_true_up").map((l) => [l.attributableWeekStart, l.amountCents]),
    ).toEqual([[WEEK_1, 667]]);
    expect(sheet.totalCents).toBe(84_000 + 31_500 + 20_000 + 12_000 + 2_000 + 667);
    // Bookkeeping for the next true-up.
    expect(sheet.overtimeWeeks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          weekStart: WEEK_1,
          attributedCents: 84_000,
          adjustmentPaidCents: 4_667,
        }),
        expect.objectContaining({
          weekStart: WEEK_6,
          attributedCents: 20_000,
          adjustmentPaidCents: 2_000,
        }),
      ]),
    );
  });

  it("spiffs are attributable to the week of the job or sale", () => {
    const run = assemblePayRun({
      mode: "live",
      weekStart: WEEK_6,
      minimumWageCentsPerHour: MIN_WAGE,
      employees: [{ userId: "tech", wageCentsPerHour: 2_100, totalMinutes: 2_400 }],
      lines: [line("spiff", 5_000, WEEK_1), line("combo", 7_500, WEEK_1)],
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
    const sheet = only(run.sheets);
    expect(linesOf(sheet, "ot_adjustment")).toEqual([]); // 40 h in week 6
    // 0.5 × $125 ÷ 45 × 5 = $6.944 → $6.94
    expect(linesOf(sheet, "ot_true_up").map((l) => l.amountCents)).toEqual([694]);
  });

  it("a late line from a week without overtime needs no true-up", () => {
    const run = assemblePayRun({
      mode: "live",
      weekStart: WEEK_6,
      minimumWageCentsPerHour: MIN_WAGE,
      employees: [{ userId: "tech", wageCentsPerHour: 2_100, totalMinutes: 2_700 }],
      lines: [line("commission", 12_000, WEEK_1)],
      priorWeeks: [
        {
          userId: "tech",
          weekStart: WEEK_1,
          totalMinutes: 2_400,
          otMinutes: 0,
          attributedCents: 50_000,
          adjustmentPaidCents: 0,
        },
      ],
    });
    const sheet = only(run.sheets);
    expect(linesOf(sheet, "ot_true_up")).toEqual([]);
    // Week 6 has overtime but nothing attributable to it.
    expect(sheet.otAdjustmentCents).toBe(0);
  });

  it("the booking-rate bonus is attributable to its own week", () => {
    const run = assemblePayRun({
      mode: "live",
      weekStart: WEEK_6,
      minimumWageCentsPerHour: MIN_WAGE,
      employees: [{ userId: "csr", wageCentsPerHour: 1_800, totalMinutes: 2_520 }],
      lines: [line("booking_rate", 10_000, WEEK_6, "csr"), line("booking", 500, WEEK_6, "csr")],
    });
    const sheet = only(run.sheets);
    // 0.5 × $105 ÷ 42 h × 2 h = $2.50
    expect(sheet.otAdjustmentCents).toBe(250);
    expect(sheet.spiffsCents).toBe(10_500);
  });

  it("commission and spiff lines must say which week they're attributable to", () => {
    const base = {
      mode: "live" as const,
      weekStart: WEEK_6,
      minimumWageCentsPerHour: MIN_WAGE,
      employees: [{ userId: "tech", wageCentsPerHour: 2_100, totalMinutes: 2_400 }],
    };
    expect(() => assemblePayRun({ ...base, lines: [line("commission", 100)] })).toThrow();
    expect(() => assemblePayRun({ ...base, lines: [line("spiff", 100)] })).toThrow();
    // A line can't be attributable to a week after the run.
    expect(() =>
      assemblePayRun({ ...base, lines: [line("commission", 100, "2026-11-16")] }),
    ).toThrow();
  });

  it("every line is explained and the sheet total is exactly the sum of its lines", () => {
    const run = assemblePayRun({
      mode: "live",
      weekStart: WEEK_6,
      minimumWageCentsPerHour: MIN_WAGE,
      employees: [
        { userId: "tech", name: "Tess", wageCentsPerHour: 2_133, totalMinutes: 2_777 },
        { userId: "csr", wageCentsPerHour: 1_777, totalMinutes: 1_999 },
      ],
      lines: [
        line("commission", 33_333, WEEK_6),
        line("spiff", 2_000, WEEK_6),
        line("callback_deduction", -6_200),
        line("booking_rate", 5_000, WEEK_6, "csr"),
      ],
    });
    for (const sheet of run.sheets) {
      expect(sheet.totalCents).toBe(sheet.lines.reduce((sum, l) => sum + l.amountCents, 0));
      expect(sheet.totalCents).toBe(
        sheet.hourlyCents +
          sheet.commissionCents +
          sheet.spiffsCents +
          sheet.deductionsCents +
          sheet.otAdjustmentCents,
      );
      for (const l of sheet.lines) {
        expect(Number.isSafeInteger(l.amountCents)).toBe(true);
        expect(l.explanation.trim().length).toBeGreaterThan(0);
      }
    }
    expect(run.totalCents).toBe(run.sheets.reduce((sum, s) => sum + s.totalCents, 0));
  });
});

describe("9a. Practice mode until rollout", () => {
  const input = {
    weekStart: WEEK_6,
    minimumWageCentsPerHour: MIN_WAGE,
    employees: [{ userId: "tech", wageCentsPerHour: 2_100, totalMinutes: 2_400 }],
    lines: [line("commission", 6_200, WEEK_6)],
  };

  it("a practice sheet says it isn't paid", () => {
    const sheet = only(assemblePayRun({ ...input, mode: "practice" }).sheets);
    expect(sheet.mode).toBe("practice");
    expect(sheet.explanation.startsWith("PRACTICE ONLY, not paid.")).toBe(true);
  });

  it("a live sheet doesn't, and the amounts are the same", () => {
    const live = only(assemblePayRun({ ...input, mode: "live" }).sheets);
    const practice = only(assemblePayRun({ ...input, mode: "practice" }).sheets);
    expect(live.explanation).not.toContain("PRACTICE");
    expect(live.totalCents).toBe(practice.totalCents);
  });
});
