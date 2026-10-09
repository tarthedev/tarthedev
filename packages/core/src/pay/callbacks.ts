/**
 * Callbacks, the 30-day "oops rule" (docs/02-commission-plan.md section 6), and the
 * deduction cap that keeps deductions from taking pay below minimum wage or touching
 * overtime wages (NC G.S. 95-25.8). Anything that can't be taken carries forward.
 */

import { assertNonNegativeInt, divCeil } from "../internal/int";
import { assertCents, type Cents, formatCents, formatMinutes } from "../money";
import { daysBetween, type LocalDate } from "../time/weeks";
import type { PayLineStatus } from "./payability";

/** A callback must come within 30 days of the original job's finish date. */
export const DEFAULT_CALLBACK_WINDOW_DAYS = 30;

export type ClawbackDecision =
  | {
      action: "none";
      reason:
        | "awaiting_decision"
        | "not_tech_caused"
        | "outside_window"
        | "nothing_to_recover"
        | "already_canceled";
      explanation: string;
    }
  | { action: "cancel"; explanation: string }
  | { action: "deduct"; amountCents: Cents; explanation: string };

export type OriginalLine = {
  status: PayLineStatus;
  /** The original line's amount (this tech's share), a positive number or zero. */
  amountCents: Cents;
};

/**
 * Shared rule for taking back an earlier line: cancel it if it wasn't paid yet,
 * otherwise deduct exactly what was paid.
 */
function clawback(original: OriginalLine, what: string, why: string): ClawbackDecision {
  const amount = assertNonNegativeInt(original.amountCents, "original.amountCents");
  if (original.status === "canceled") {
    return {
      action: "none",
      reason: "already_canceled",
      explanation: `${why} The original ${what} was already canceled, so there's nothing to take back.`,
    };
  }
  if (original.status === "pending_payment" || original.status === "payable") {
    return {
      action: "cancel",
      explanation: `${why} The original ${what} (${formatCents(amount)}) hadn't been paid yet, so it is canceled instead of deducted.`,
    };
  }
  if (amount === 0) {
    return {
      action: "none",
      reason: "nothing_to_recover",
      explanation: `${why} The original ${what} paid ${formatCents(0)}, so there's nothing to deduct.`,
    };
  }
  return {
    action: "deduct",
    amountCents: -amount,
    explanation: `${why} The original ${what} of ${formatCents(amount)} was paid, so this deduction is ${formatCents(-amount)}.`,
  };
}

export type CallbackInput = {
  /** The original job's finish date (local). */
  originalFinishedOn: LocalDate;
  /** The date the callback was booked (local). */
  callbackOn: LocalDate;
  /** The manager's call: true, false, or null while not yet decided. */
  techCaused: boolean | null;
  /** The reason the manager gave (shown to the tech). */
  reason?: string;
  /** The original job's commission line for this tech. */
  originalCommission: OriginalLine;
  windowDays?: number;
};

/**
 * What a callback does to the original job's commission: a negative line equal to the
 * commission paid, "cancel" if it wasn't paid yet, or nothing when not tech-caused or
 * outside the window.
 */
export function callbackDeduction(input: CallbackInput): ClawbackDecision {
  const windowDays = assertNonNegativeInt(
    input.windowDays ?? DEFAULT_CALLBACK_WINDOW_DAYS,
    "windowDays",
  );
  const days = daysBetween(input.originalFinishedOn, input.callbackOn);
  if (days < 0) {
    throw new RangeError("A callback can't be booked before the original job was finished");
  }
  const reasonText = input.reason?.trim() ? ` Reason: ${input.reason.trim()}.` : "";
  if (days > windowDays) {
    return {
      action: "none",
      reason: "outside_window",
      explanation: `This visit came ${days} days after the original job, outside the ${windowDays}-day callback window, so your commission stays.`,
    };
  }
  if (input.techCaused === null) {
    return {
      action: "none",
      reason: "awaiting_decision",
      explanation: "A manager hasn't decided yet whether this callback was tech-caused.",
    };
  }
  if (!input.techCaused) {
    return {
      action: "none",
      reason: "not_tech_caused",
      explanation: `A manager marked this callback not tech-caused, so your commission stays.${reasonText}`,
    };
  }
  return clawback(
    input.originalCommission,
    "commission",
    `A manager marked this callback tech-caused (${days} days after the original job).${reasonText}`,
  );
}

/** A membership refunded within 30 days takes back its spiff. */
export const DEFAULT_MEMBERSHIP_REFUND_WINDOW_DAYS = 30;

/** What a membership refund does to its spiff: deduct if paid, cancel if not, nothing after 30 days. */
export function membershipRefundDeduction(input: {
  soldOn: LocalDate;
  refundedOn: LocalDate;
  originalSpiff: OriginalLine;
  windowDays?: number;
}): ClawbackDecision {
  const windowDays = assertNonNegativeInt(
    input.windowDays ?? DEFAULT_MEMBERSHIP_REFUND_WINDOW_DAYS,
    "windowDays",
  );
  const days = daysBetween(input.soldOn, input.refundedOn);
  if (days < 0) {
    throw new RangeError("A membership can't be refunded before it was sold");
  }
  if (days > windowDays) {
    return {
      action: "none",
      reason: "outside_window",
      explanation: `The membership was refunded ${days} days after the sale, outside the ${windowDays}-day window, so the spiff stays.`,
    };
  }
  return clawback(
    input.originalSpiff,
    "membership spiff",
    `The membership was refunded ${days} days after the sale.`,
  );
}

export type DeductionCapInput = {
  /** Total deductions owed this run, carried-in amounts included (a positive number). */
  owedCents: Cents;
  /** This run's non-overtime pay: regular hourly pay plus commission, spiffs and adjustments. */
  nonOvertimePayCents: Cents;
  /** Non-overtime minutes worked in the pay week. */
  nonOvertimeMinutes: number;
  /** The minimum wage the remaining non-overtime pay must cover. */
  minimumWageCentsPerHour: Cents;
};

export type DeductionCapResult = {
  takenCents: Cents;
  carryForwardCents: Cents;
  /** Non-overtime pay above the minimum-wage floor. */
  availableCents: Cents;
  /** Minimum wage × non-overtime hours, rounded up in the employee's favor. */
  floorCents: Cents;
  explanation: string;
};

/**
 * Caps deductions against non-overtime pay so pay never drops below minimum wage for the
 * non-overtime hours and overtime wages are never touched. The rest carries forward.
 */
export function capDeduction(input: DeductionCapInput): DeductionCapResult {
  const owed = assertNonNegativeInt(input.owedCents, "owedCents");
  const pay = assertCents(input.nonOvertimePayCents, "nonOvertimePayCents");
  const minutes = assertNonNegativeInt(input.nonOvertimeMinutes, "nonOvertimeMinutes");
  const wage = assertNonNegativeInt(input.minimumWageCentsPerHour, "minimumWageCentsPerHour");
  const floorCents = Number(divCeil(BigInt(minutes) * BigInt(wage), 60n));
  const availableCents = Math.max(0, pay - floorCents);
  const takenCents = Math.min(owed, availableCents);
  const carryForwardCents = owed - takenCents;
  const explanation =
    owed === 0
      ? "No deductions this run."
      : carryForwardCents === 0
        ? `All ${formatCents(owed)} of deductions are taken this run.`
        : `${formatCents(takenCents)} of the ${formatCents(owed)} in deductions is taken this run. Deductions can't take pay below minimum wage (${formatCents(wage)}/hr × ${formatMinutes(minutes)} = ${formatCents(floorCents)}) or touch overtime, so ${formatCents(carryForwardCents)} carries forward to the next run.`;
  return { takenCents, carryForwardCents, availableCents, floorCents, explanation };
}
