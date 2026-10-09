/**
 * Overtime regular-rate adjustment (docs/02-commission-plan.md section 9).
 *
 *   adjustment(W) = 0.5 × (commission + spiffs attributable to W) ÷ total hours in W × overtime hours in W
 *
 * computed in integers as half-up(C × otMinutes ÷ (2 × totalMinutes)).
 * When lines attributable to an earlier week are paid later, adjustment(W) is recomputed and
 * the difference is paid as an overtime true-up, so the adjustments paid for W always add up
 * to adjustment(W) on everything attributed to W.
 */

import { assertNonNegativeInt } from "../internal/int";
import { assertCents, type Cents, formatCents, formatMinutes, mulDivHalfUp } from "../money";

/** Overtime is time over 40 hours in the pay week. */
export const DEFAULT_OVERTIME_THRESHOLD_MINUTES = 40 * 60;

/** Overtime minutes in a week: everything over the threshold (default 40 hours). */
export function overtimeMinutes(
  totalMinutes: number,
  thresholdMinutes: number = DEFAULT_OVERTIME_THRESHOLD_MINUTES,
): number {
  assertNonNegativeInt(totalMinutes, "totalMinutes");
  assertNonNegativeInt(thresholdMinutes, "thresholdMinutes");
  return Math.max(0, totalMinutes - thresholdMinutes);
}

/** half-up(C × otMinutes ÷ (2 × totalMinutes)); zero when there was no overtime. */
export function otAdjustment(
  commissionAndSpiffsCents: Cents,
  totalMinutes: number,
  otMinutes: number,
): Cents {
  assertCents(commissionAndSpiffsCents, "commissionAndSpiffsCents");
  assertNonNegativeInt(totalMinutes, "totalMinutes");
  assertNonNegativeInt(otMinutes, "otMinutes");
  if (otMinutes > totalMinutes) {
    throw new RangeError("Overtime minutes can't exceed total minutes worked");
  }
  if (otMinutes === 0) return 0;
  return mulDivHalfUp(commissionAndSpiffsCents, otMinutes, 2 * totalMinutes);
}

/** Explains an overtime adjustment in plain English. */
export function explainOtAdjustment(
  commissionAndSpiffsCents: Cents,
  totalMinutes: number,
  otMinutes: number,
  weekStart: string,
): string {
  const amount = otAdjustment(commissionAndSpiffsCents, totalMinutes, otMinutes);
  return `Overtime adjustment for the week of ${weekStart}: 0.5 × ${formatCents(commissionAndSpiffsCents)} commission and spiffs ÷ ${formatMinutes(totalMinutes)} worked × ${formatMinutes(otMinutes)} overtime = ${formatCents(amount)}.`;
}

export type OtTrueUpInput = {
  weekStart: string;
  totalMinutes: number;
  otMinutes: number;
  /** Commission and spiffs already attributed to the week in earlier runs. */
  previouslyAttributedCents: Cents;
  /** Commission and spiffs attributable to the week, paid in this run. */
  newlyAttributedCents: Cents;
  /** Overtime adjustments and true-ups already paid for the week. */
  adjustmentAlreadyPaidCents: Cents;
};

export type OtTrueUp = {
  amountCents: Cents;
  /** adjustment(W) recomputed on everything now attributed to W. */
  recomputedAdjustmentCents: Cents;
  explanation: string;
};

/** The overtime true-up for an earlier week when late lines attributable to it are paid. */
export function otTrueUp(input: OtTrueUpInput): OtTrueUp {
  const previous = assertCents(input.previouslyAttributedCents, "previouslyAttributedCents");
  const added = assertCents(input.newlyAttributedCents, "newlyAttributedCents");
  const paid = assertCents(input.adjustmentAlreadyPaidCents, "adjustmentAlreadyPaidCents");
  const attributed = previous + added;
  const recomputed = otAdjustment(attributed, input.totalMinutes, input.otMinutes);
  const amountCents = recomputed - paid;
  const explanation =
    input.otMinutes === 0
      ? `No overtime in the week of ${input.weekStart}, so no overtime true-up.`
      : `Overtime true-up for the week of ${input.weekStart}: ${formatCents(added)} more commission and spiffs from that week were paid now. ` +
        `0.5 × ${formatCents(attributed)} ÷ ${formatMinutes(input.totalMinutes)} worked × ${formatMinutes(input.otMinutes)} overtime = ${formatCents(recomputed)}` +
        (paid === 0 ? "" : `, minus ${formatCents(paid)} already paid`) +
        ` = ${formatCents(amountCents)}.`;
  return { amountCents, recomputedAdjustmentCents: recomputed, explanation };
}
