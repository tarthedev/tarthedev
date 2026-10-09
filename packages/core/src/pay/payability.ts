/**
 * When commission is paid (docs/02-commission-plan.md section 5).
 *
 * - A line is payable once the job is paid in full; partial payments pay nothing.
 * - Payable lines go on the next weekly run at the rate locked for the week the job was finished.
 * - Cost changes after payment of more than the threshold (default $50) add an adjustment line.
 * - Refunds and chargebacks after payment create a deduction for the commission on the refund.
 */

import { assertNonNegativeInt, assertText, divRoundHalfUp, toSafeNumber } from "../internal/int";
import {
  assertBps,
  assertCents,
  BPS_SCALE,
  type Bps,
  type Cents,
  formatBps,
  formatCents,
} from "../money";
import { assertWeekStart, type Instant, type LocalDate, payWeekStart } from "../time/weeks";
import { type CommissionLineResult, commissionLine, explainCommissionLine } from "./commission";

/** Statuses of a pay line, as stored in `pay_lines.status`. */
export type PayLineStatus = "pending_payment" | "payable" | "paid" | "canceled";

export type InvoiceBalance = {
  balanceCents: Cents;
  /** True while a financed invoice waits for GreenSky to fund it. */
  awaitingFinancing?: boolean;
};

/**
 * Paid in full: every invoice on the job has a $0 balance (an overpayment counts) and no
 * financed invoice is still waiting for GreenSky to fund. A job with no invoices isn't paid.
 */
export function isPaidInFull(invoices: readonly InvoiceBalance[]): boolean {
  if (invoices.length === 0) return false;
  return invoices.every((invoice, index) => {
    assertCents(invoice.balanceCents, `invoices[${index}].balanceCents`);
    return invoice.balanceCents <= 0 && !invoice.awaitingFinancing;
  });
}

/** A new line's status: payable when the job is paid in full, otherwise pending payment. */
export function lineStatusFor(
  paidInFull: boolean,
): Extract<PayLineStatus, "pending_payment" | "payable"> {
  return paidInFull ? "payable" : "pending_payment";
}

/** The pay week whose run picks up a line that became payable at `payableAt`. */
export function payrollWeekFor(payableAt: Instant): LocalDate {
  return payWeekStart(payableAt);
}

export type LockedWeek = {
  weekStart: LocalDate;
  levelName: string;
  rateBps: Bps;
  /** When the week locked (Sunday night), or null while it is still open. */
  lockedAt: string | null;
};

export type LockedCommissionLine = CommissionLineResult & { attributableWeekStart: LocalDate };

/**
 * A job's commission at the rate locked for the week it was finished. Throws if that week
 * hasn't locked yet, because its rate can still change.
 */
export function commissionAtLockedRate(input: {
  jobId: string;
  creditedGpCents: Cents;
  finishedWeek: LockedWeek;
}): LockedCommissionLine {
  assertText(input.jobId, "jobId");
  const week = input.finishedWeek;
  assertWeekStart(week.weekStart, "finishedWeek.weekStart");
  if (week.lockedAt === null) {
    throw new RangeError(
      `The week of ${week.weekStart} hasn't locked yet, so its rate isn't final`,
    );
  }
  return {
    jobId: input.jobId,
    creditedGpCents: input.creditedGpCents,
    rateBps: week.rateBps,
    levelName: week.levelName,
    amountCents: commissionLine(input.creditedGpCents, week.rateBps),
    attributableWeekStart: week.weekStart,
    explanation: `${explainCommissionLine(
      input.creditedGpCents,
      week.rateBps,
      week.levelName,
      `Job ${input.jobId}`,
    )} Rate locked for the week of ${week.weekStart}, when the job was finished.`,
  };
}

/** Default: cost changes of $50 or less after payment are ignored. */
export const DEFAULT_COST_CHANGE_THRESHOLD_CENTS: Cents = 5_000;

export type CostChangeInput = {
  /** The job's total costs when this tech's commission was last settled (paid or adjusted). */
  settledCostsCents: Cents;
  /** The job's total costs now. */
  currentCostsCents: Cents;
  /** This tech's credited GP recomputed with the current costs. */
  newCreditedGpCents: Cents;
  /** The rate locked for the week the job was finished. */
  rateBps: Bps;
  /** Commission already paid to this tech for this job, earlier adjustments included. */
  commissionPaidCents: Cents;
  /** Changes must be more than this to count. Default $50. */
  thresholdCents?: Cents;
};

export type CostChangeResult =
  | { kind: "ignored"; costChangeCents: Cents; explanation: string }
  | { kind: "no_change"; costChangeCents: Cents; explanation: string }
  | {
      kind: "adjustment";
      costChangeCents: Cents;
      newCommissionCents: Cents;
      amountCents: Cents;
      explanation: string;
    };

/**
 * After a job's commission was paid, a cost change of more than the threshold adds an
 * adjustment line (positive or negative) equal to the recalculated commission minus what was paid.
 */
export function costChangeAdjustment(input: CostChangeInput): CostChangeResult {
  const settled = assertCents(input.settledCostsCents, "settledCostsCents");
  const current = assertCents(input.currentCostsCents, "currentCostsCents");
  const paid = assertCents(input.commissionPaidCents, "commissionPaidCents");
  const threshold = assertNonNegativeInt(
    input.thresholdCents ?? DEFAULT_COST_CHANGE_THRESHOLD_CENTS,
    "thresholdCents",
  );
  assertBps(input.rateBps, "rateBps");
  const costChangeCents = current - settled;
  const changeText = `${costChangeCents > 0 ? "rose" : "fell"} by ${formatCents(Math.abs(costChangeCents))}`;

  if (Math.abs(costChangeCents) <= threshold) {
    return {
      kind: "ignored",
      costChangeCents,
      explanation:
        costChangeCents === 0
          ? "Job costs haven't changed since your commission was paid."
          : `Job costs ${changeText} after your commission was paid. Changes of ${formatCents(threshold)} or less are ignored.`,
    };
  }

  const newCommissionCents = commissionLine(input.newCreditedGpCents, input.rateBps);
  const amountCents = newCommissionCents - paid;
  if (amountCents === 0) {
    return {
      kind: "no_change",
      costChangeCents,
      explanation: `Job costs ${changeText} after your commission was paid, but your commission stays ${formatCents(paid)}.`,
    };
  }
  return {
    kind: "adjustment",
    costChangeCents,
    newCommissionCents,
    amountCents,
    explanation:
      `Job costs ${changeText} after your commission was paid. Your credited gross profit is now ` +
      `${formatCents(input.newCreditedGpCents)} × ${formatBps(input.rateBps)} = ${formatCents(newCommissionCents)}; ` +
      `${formatCents(paid)} was already paid, so this adjustment is ${formatCents(amountCents)}.`,
  };
}

export type RefundDeductionInput = {
  /** Sale amount refunded or charged back, excluding tax (a positive number). */
  refundedSaleCents: Cents;
  /** This tech's share of the job's GP. */
  shareBps: Bps;
  /** The rate the commission was paid at. */
  rateBps: Bps;
  /** Commission paid to this tech for this job, adjustments included. */
  commissionPaidCents: Cents;
  /** Earlier refund deductions on this job for this tech (a positive number). */
  alreadyDeductedCents?: Cents;
};

/**
 * Deduction for the commission on a refunded amount: half-up(refund × share × rate),
 * never more than the commission still standing on the job. Returns a line ≤ 0.
 */
export function refundDeduction(input: RefundDeductionInput): {
  amountCents: Cents;
  explanation: string;
} {
  const refund = assertNonNegativeInt(input.refundedSaleCents, "refundedSaleCents");
  const share = assertNonNegativeInt(input.shareBps, "shareBps");
  const rate = assertNonNegativeInt(input.rateBps, "rateBps");
  const paid = assertNonNegativeInt(input.commissionPaidCents, "commissionPaidCents");
  const already = assertNonNegativeInt(input.alreadyDeductedCents ?? 0, "alreadyDeductedCents");
  if (share > BPS_SCALE) {
    throw new RangeError("shareBps can't exceed 100%");
  }
  const onRefund = toSafeNumber(
    divRoundHalfUp(BigInt(refund) * BigInt(share) * BigInt(rate), BigInt(BPS_SCALE * BPS_SCALE)),
    "refund deduction",
  );
  const standing = Math.max(0, paid - already);
  const deduction = Math.min(onRefund, standing);
  const capped = deduction < onRefund;
  const amountCents = deduction === 0 ? 0 : -deduction;
  return {
    amountCents,
    explanation:
      `${formatCents(refund)} of this sale was refunded. Commission on your ${formatBps(share)} share at ` +
      `${formatBps(rate)} is ${formatCents(onRefund)}` +
      (capped
        ? `, capped at the ${formatCents(standing)} of commission still standing on the job`
        : "") +
      `, so this deduction is ${formatCents(amountCents)}.`,
  };
}
