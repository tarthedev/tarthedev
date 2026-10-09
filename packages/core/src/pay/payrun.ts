/**
 * Weekly pay sheet assembler (docs/02-commission-plan.md section 9).
 *
 * Given the pay lines in a run, each employee's hours for the run's pay week, and the overtime
 * history of earlier weeks that late lines are attributable to, this produces one pay sheet per
 * employee: hourly pay, commission, spiffs, deductions (capped, with carry-forward) and the
 * overtime regular-rate adjustment and true-ups. Every sheet line has a plain-English
 * explanation, and a sheet's total is exactly the sum of its lines.
 */

import { assertNonNegativeInt, assertText } from "../internal/int";
import {
  assertCents,
  type Cents,
  formatCents,
  formatMinutes,
  mulDivHalfUp,
  sumCents,
} from "../money";
import { assertWeekStart, compareLocalDates, type LocalDate } from "../time/weeks";
import { capDeduction } from "./callbacks";
import { DEFAULT_OVERTIME_THRESHOLD_MINUTES, otAdjustment, overtimeMinutes } from "./overtime";

/** `pay_lines.kind` values. */
export type PayLineKind =
  | "commission"
  | "cost_adjustment"
  | "spiff"
  | "combo"
  | "lead"
  | "booking"
  | "booking_rate"
  | "callback_deduction"
  | "refund_deduction"
  | "ot_adjustment"
  | "ot_true_up"
  | "deduction_carried_in"
  | "deduction_carry_forward";

/** Kinds a run takes as input. Overtime and carry-forward lines are computed by the assembler. */
export type RunLineKind = Exclude<
  PayLineKind,
  "ot_adjustment" | "ot_true_up" | "deduction_carried_in" | "deduction_carry_forward"
>;

/** Commission and spiff kinds: part of the regular rate for overtime. */
export const REGULAR_RATE_KINDS: readonly RunLineKind[] = Object.freeze([
  "commission",
  "cost_adjustment",
  "spiff",
  "combo",
  "lead",
  "booking",
  "booking_rate",
]);

const SPIFF_KINDS = new Set<PayLineKind>(["spiff", "combo", "lead", "booking", "booking_rate"]);
const DEDUCTION_KINDS = new Set<PayLineKind>(["callback_deduction", "refund_deduction"]);
const COMPUTED_KINDS = new Set<string>([
  "ot_adjustment",
  "ot_true_up",
  "deduction_carried_in",
  "deduction_carry_forward",
]);
const REGULAR_RATE = new Set<string>(REGULAR_RATE_KINDS);

export type RunLine = {
  /** The stored pay line's ID, echoed on the sheet. */
  id?: string;
  userId: string;
  kind: RunLineKind;
  amountCents: Cents;
  explanation: string;
  /**
   * The pay week the line is attributable to for overtime: the week the job was finished
   * (commission), the week of the job or sale (spiffs), or the bonus's own week.
   * Required for commission and spiff kinds.
   */
  attributableWeekStart?: LocalDate;
  sourceJobId?: string;
  invoiceId?: string;
};

export type EmployeeWeek = {
  userId: string;
  name?: string;
  wageCentsPerHour: Cents;
  /** All minutes worked in the run's pay week. */
  totalMinutes: number;
};

/** What earlier runs recorded for an earlier week, needed to true up its overtime adjustment. */
export type PriorWeekOvertime = {
  userId: string;
  weekStart: LocalDate;
  totalMinutes: number;
  otMinutes: number;
  /** Commission and spiffs already attributed to the week. */
  attributedCents: Cents;
  /** Overtime adjustments and true-ups already paid for the week. */
  adjustmentPaidCents: Cents;
};

export type PayRunInput = {
  /** Practice runs are never paid (the plan pays only after rollout). */
  mode: "practice" | "live";
  /** The run's pay week (Monday). */
  weekStart: LocalDate;
  employees: readonly EmployeeWeek[];
  lines: readonly RunLine[];
  priorWeeks?: readonly PriorWeekOvertime[];
  /** Deductions carried forward from earlier runs (positive amounts). */
  carriedIn?: readonly { userId: string; amountCents: Cents }[];
  minimumWageCentsPerHour: Cents;
  overtimeThresholdMinutes?: number;
};

export type PaySheetGroup =
  | "hourly"
  | "commission"
  | "spiffs"
  | "deductions"
  | "overtime_adjustment";

export type PaySheetLine = {
  kind: PayLineKind | "hourly_regular" | "hourly_overtime";
  group: PaySheetGroup;
  amountCents: Cents;
  explanation: string;
  attributableWeekStart?: LocalDate;
  sourceLineId?: string;
  sourceJobId?: string;
  invoiceId?: string;
};

export type OvertimeWeekRecord = {
  weekStart: LocalDate;
  totalMinutes: number;
  otMinutes: number;
  /** Commission and spiffs attributed to the week, this run included. */
  attributedCents: Cents;
  /** Overtime adjustments and true-ups paid for the week, this run included. */
  adjustmentPaidCents: Cents;
};

export type PaySheet = {
  userId: string;
  name?: string;
  weekStart: LocalDate;
  mode: PayRunInput["mode"];
  regularMinutes: number;
  overtimeMinutes: number;
  hourlyCents: Cents;
  commissionCents: Cents;
  spiffsCents: Cents;
  /**
   * Sum of the deductions group: deduction lines, carried-in amounts and the carry-forward credit.
   * Usually zero or negative; positive only when a negative cost adjustment or overtime true-up
   * (shown in its own group) can't be taken and is carried forward.
   */
  deductionsCents: Cents;
  otAdjustmentCents: Cents;
  /** Deductions that couldn't be taken and carry to the next run (a positive amount). */
  carryForwardCents: Cents;
  totalCents: Cents;
  lines: PaySheetLine[];
  /** Overtime bookkeeping to store, for true-ups in later runs. */
  overtimeWeeks: OvertimeWeekRecord[];
  explanation: string;
};

export type PayRun = {
  weekStart: LocalDate;
  mode: PayRunInput["mode"];
  sheets: PaySheet[];
  totalCents: Cents;
};

const GROUP_ORDER: readonly PaySheetGroup[] = [
  "hourly",
  "commission",
  "spiffs",
  "deductions",
  "overtime_adjustment",
];

function groupFor(kind: RunLineKind): PaySheetGroup {
  if (kind === "commission" || kind === "cost_adjustment") return "commission";
  if (SPIFF_KINDS.has(kind)) return "spiffs";
  return "deductions";
}

function validateLine(line: RunLine, index: number, runWeek: LocalDate): void {
  const name = `lines[${index}]`;
  assertText(line.userId, `${name}.userId`);
  assertText(line.explanation, `${name}.explanation`);
  assertCents(line.amountCents, `${name}.amountCents`);
  if (COMPUTED_KINDS.has(line.kind)) {
    throw new RangeError(`${name}: ${line.kind} lines are computed by the pay run, not passed in`);
  }
  if (!REGULAR_RATE.has(line.kind) && !DEDUCTION_KINDS.has(line.kind)) {
    throw new RangeError(`${name}: unknown pay line kind ${String(line.kind)}`);
  }
  if (DEDUCTION_KINDS.has(line.kind) && line.amountCents > 0) {
    throw new RangeError(`${name}: a ${line.kind} line can't be positive`);
  }
  if ((line.kind === "commission" || SPIFF_KINDS.has(line.kind)) && line.amountCents < 0) {
    throw new RangeError(`${name}: a ${line.kind} line can't be negative; use a deduction line`);
  }
  if (REGULAR_RATE.has(line.kind)) {
    if (line.attributableWeekStart === undefined) {
      throw new RangeError(`${name}: a ${line.kind} line needs the week it is attributable to`);
    }
    assertWeekStart(line.attributableWeekStart, `${name}.attributableWeekStart`);
    if (compareLocalDates(line.attributableWeekStart, runWeek) > 0) {
      throw new RangeError(`${name} is attributable to a week after this run`);
    }
  }
}

function weekKey(userId: string, weekStart: LocalDate): string {
  return `${userId}\u0000${weekStart}`;
}

/** Assembles every employee's pay sheet for one weekly payroll run. */
export function assemblePayRun(input: PayRunInput): PayRun {
  const weekStart = assertWeekStart(input.weekStart, "weekStart");
  if (input.mode !== "practice" && input.mode !== "live") {
    throw new RangeError(`mode must be "practice" or "live"`);
  }
  const minimumWage = assertNonNegativeInt(
    input.minimumWageCentsPerHour,
    "minimumWageCentsPerHour",
  );
  const threshold = assertNonNegativeInt(
    input.overtimeThresholdMinutes ?? DEFAULT_OVERTIME_THRESHOLD_MINUTES,
    "overtimeThresholdMinutes",
  );

  const employees = new Map<string, EmployeeWeek>();
  input.employees.forEach((employee, index) => {
    assertText(employee.userId, `employees[${index}].userId`);
    assertNonNegativeInt(employee.wageCentsPerHour, `employees[${index}].wageCentsPerHour`);
    assertNonNegativeInt(employee.totalMinutes, `employees[${index}].totalMinutes`);
    if (employees.has(employee.userId)) {
      throw new RangeError(`Employee ${employee.userId} is listed twice`);
    }
    employees.set(employee.userId, employee);
  });

  input.lines.forEach((line, index) => {
    validateLine(line, index, weekStart);
    if (!employees.has(line.userId)) {
      throw new RangeError(`lines[${index}] is for ${line.userId}, who has no hours in this run`);
    }
  });

  const priors = new Map<string, PriorWeekOvertime>();
  (input.priorWeeks ?? []).forEach((prior, index) => {
    const name = `priorWeeks[${index}]`;
    assertText(prior.userId, `${name}.userId`);
    assertWeekStart(prior.weekStart, `${name}.weekStart`);
    assertNonNegativeInt(prior.totalMinutes, `${name}.totalMinutes`);
    assertNonNegativeInt(prior.otMinutes, `${name}.otMinutes`);
    assertCents(prior.attributedCents, `${name}.attributedCents`);
    assertCents(prior.adjustmentPaidCents, `${name}.adjustmentPaidCents`);
    const key = weekKey(prior.userId, prior.weekStart);
    if (priors.has(key)) {
      throw new RangeError(`${name} repeats ${prior.userId} for the week of ${prior.weekStart}`);
    }
    priors.set(key, prior);
  });

  const carried = new Map<string, Cents>();
  (input.carriedIn ?? []).forEach((entry, index) => {
    assertText(entry.userId, `carriedIn[${index}].userId`);
    const amount = assertNonNegativeInt(entry.amountCents, `carriedIn[${index}].amountCents`);
    if (!employees.has(entry.userId)) {
      throw new RangeError(
        `carriedIn[${index}] is for ${entry.userId}, who has no hours in this run`,
      );
    }
    carried.set(entry.userId, (carried.get(entry.userId) ?? 0) + amount);
  });

  const sheets = input.employees.map((employee) =>
    buildSheet({
      employee,
      weekStart,
      mode: input.mode,
      lines: input.lines.filter((line) => line.userId === employee.userId),
      priors,
      carriedInCents: carried.get(employee.userId) ?? 0,
      minimumWage,
      threshold,
    }),
  );

  return {
    weekStart,
    mode: input.mode,
    sheets,
    totalCents: sumCents(sheets.map((sheet) => sheet.totalCents)),
  };
}

function buildSheet(args: {
  employee: EmployeeWeek;
  weekStart: LocalDate;
  mode: PayRunInput["mode"];
  lines: readonly RunLine[];
  priors: ReadonlyMap<string, PriorWeekOvertime>;
  carriedInCents: Cents;
  minimumWage: Cents;
  threshold: number;
}): PaySheet {
  const { employee, weekStart, lines } = args;
  const wage = employee.wageCentsPerHour;
  const otMinutes = overtimeMinutes(employee.totalMinutes, args.threshold);
  const regularMinutes = employee.totalMinutes - otMinutes;
  const regularPay = mulDivHalfUp(regularMinutes, wage, 60);
  const overtimePay = mulDivHalfUp(otMinutes, wage * 3, 120);

  const sheetLines: PaySheetLine[] = [
    {
      kind: "hourly_regular",
      group: "hourly",
      amountCents: regularPay,
      explanation: `${formatMinutes(regularMinutes)} regular time × ${formatCents(wage)}/hr = ${formatCents(regularPay)}.`,
    },
  ];
  if (otMinutes > 0) {
    sheetLines.push({
      kind: "hourly_overtime",
      group: "hourly",
      amountCents: overtimePay,
      explanation: `${formatMinutes(otMinutes)} overtime (over ${formatMinutes(args.threshold)}) × 1.5 × ${formatCents(wage)}/hr = ${formatCents(overtimePay)}.`,
    });
  }

  for (const line of lines) {
    sheetLines.push({
      kind: line.kind,
      group: groupFor(line.kind),
      amountCents: line.amountCents,
      explanation: line.explanation,
      ...(line.attributableWeekStart === undefined
        ? {}
        : { attributableWeekStart: line.attributableWeekStart }),
      ...(line.id === undefined ? {} : { sourceLineId: line.id }),
      ...(line.sourceJobId === undefined ? {} : { sourceJobId: line.sourceJobId }),
      ...(line.invoiceId === undefined ? {} : { invoiceId: line.invoiceId }),
    });
  }

  // Overtime regular-rate adjustment for this week, and true-ups for earlier weeks.
  const attributedByWeek = new Map<LocalDate, Cents>();
  for (const line of lines) {
    if (!REGULAR_RATE.has(line.kind) || line.attributableWeekStart === undefined) continue;
    const week = line.attributableWeekStart;
    attributedByWeek.set(week, sumCents([attributedByWeek.get(week) ?? 0, line.amountCents]));
  }
  if (!attributedByWeek.has(weekStart)) attributedByWeek.set(weekStart, 0);
  const overtimeWeeks: OvertimeWeekRecord[] = [];
  const weeks = [...attributedByWeek.keys()].sort(compareLocalDates);
  for (const week of weeks) {
    const added = attributedByWeek.get(week) ?? 0;
    const prior = args.priors.get(weekKey(employee.userId, week));
    const isRunWeek = week === weekStart;
    if (!isRunWeek && !prior) {
      throw new RangeError(
        `${employee.userId} has lines attributable to the week of ${week} but no overtime history for it`,
      );
    }
    const total = isRunWeek ? employee.totalMinutes : (prior?.totalMinutes ?? 0);
    const ot = isRunWeek ? otMinutes : (prior?.otMinutes ?? 0);
    const previouslyAttributed = prior?.attributedCents ?? 0;
    const alreadyPaid = prior?.adjustmentPaidCents ?? 0;
    const attributed = sumCents([previouslyAttributed, added]);
    const due = otAdjustment(attributed, total, ot) - alreadyPaid;
    if (due !== 0) {
      sheetLines.push({
        kind: isRunWeek ? "ot_adjustment" : "ot_true_up",
        group: "overtime_adjustment",
        amountCents: due,
        attributableWeekStart: week,
        explanation: isRunWeek
          ? `Overtime adjustment: 0.5 × ${formatCents(attributed)} commission and spiffs from this week ÷ ${formatMinutes(total)} worked × ${formatMinutes(ot)} overtime = ${formatCents(due + alreadyPaid)}${alreadyPaid === 0 ? "" : `, minus ${formatCents(alreadyPaid)} already paid = ${formatCents(due)}`}.`
          : `Overtime true-up for the week of ${week}: commission and spiffs from that week are now ${formatCents(attributed)}. 0.5 × ${formatCents(attributed)} ÷ ${formatMinutes(total)} worked × ${formatMinutes(ot)} overtime = ${formatCents(due + alreadyPaid)}${alreadyPaid === 0 ? "" : `, minus ${formatCents(alreadyPaid)} already paid`} = ${formatCents(due)}.`,
      });
    }
    overtimeWeeks.push({
      weekStart: week,
      totalMinutes: total,
      otMinutes: ot,
      attributedCents: attributed,
      adjustmentPaidCents: alreadyPaid + due,
    });
  }

  // Deductions: every negative line (negative overtime true-ups included) plus anything carried
  // in, capped against non-overtime pay so pay never drops below minimum wage (section 6).
  const negatives = [...lines, ...sheetLines.filter((line) => line.group === "overtime_adjustment")]
    .filter((line) => line.amountCents < 0)
    .map((line) => -line.amountCents);
  const positives = lines.filter((line) => line.amountCents > 0).map((line) => line.amountCents);
  const owed = sumCents([args.carriedInCents, ...negatives]);
  const cap = capDeduction({
    owedCents: owed,
    nonOvertimePayCents: sumCents([regularPay, ...positives]),
    nonOvertimeMinutes: regularMinutes,
    minimumWageCentsPerHour: args.minimumWage,
  });
  if (args.carriedInCents > 0) {
    sheetLines.push({
      kind: "deduction_carried_in",
      group: "deductions",
      amountCents: -args.carriedInCents,
      explanation: `Deductions carried from an earlier run: ${formatCents(-args.carriedInCents)}.`,
    });
  }
  if (cap.carryForwardCents > 0) {
    sheetLines.push({
      kind: "deduction_carry_forward",
      group: "deductions",
      amountCents: cap.carryForwardCents,
      explanation: cap.explanation,
    });
  }

  sheetLines.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
  const groupTotal = (group: PaySheetGroup): Cents =>
    sumCents(sheetLines.filter((line) => line.group === group).map((line) => line.amountCents));
  const hourlyCents = groupTotal("hourly");
  const commissionCents = groupTotal("commission");
  const spiffsCents = groupTotal("spiffs");
  const deductionsCents = groupTotal("deductions");
  const otAdjustmentCents = groupTotal("overtime_adjustment");
  const totalCents = sumCents(sheetLines.map((line) => line.amountCents));

  const parts = [`Hourly ${formatCents(hourlyCents)}`];
  if (commissionCents !== 0) parts.push(`commission ${formatCents(commissionCents)}`);
  if (spiffsCents !== 0) parts.push(`spiffs and bonuses ${formatCents(spiffsCents)}`);
  if (deductionsCents !== 0) parts.push(`deductions ${formatCents(deductionsCents)}`);
  if (otAdjustmentCents !== 0) parts.push(`overtime adjustment ${formatCents(otAdjustmentCents)}`);
  const summary = `${parts.join(" + ")} = ${formatCents(totalCents)}.`;
  const carryNote =
    cap.carryForwardCents > 0
      ? ` ${formatCents(cap.carryForwardCents)} of deductions carries to the next run.`
      : "";

  return {
    userId: employee.userId,
    ...(employee.name === undefined ? {} : { name: employee.name }),
    weekStart,
    mode: args.mode,
    regularMinutes,
    overtimeMinutes: otMinutes,
    hourlyCents,
    commissionCents,
    spiffsCents,
    deductionsCents,
    otAdjustmentCents,
    carryForwardCents: cap.carryForwardCents,
    totalCents,
    lines: sheetLines,
    overtimeWeeks,
    explanation: `${args.mode === "practice" ? "PRACTICE ONLY, not paid. " : ""}Week of ${weekStart}: ${summary}${carryNote}`,
  };
}
