/**
 * Commission lines (docs/02-commission-plan.md section 4):
 * line = max(0, rate × credited GP), rounded half-up to the cent.
 * A negative-GP job lowers the week score but never creates a negative line,
 * so a week's commission never goes below zero.
 */

import { assertText } from "../internal/int";
import {
  applyBps,
  assertBps,
  assertCents,
  type Bps,
  type Cents,
  formatBps,
  formatCents,
  sumCents,
} from "../money";
import { DEFAULT_LADDER, type LadderStep, levelFor, type ScoredCredit, weekScore } from "./ladder";

/** max(0, half-up(rate × credited GP)). */
export function commissionLine(creditedGpCents: Cents, rateBps: Bps): Cents {
  assertCents(creditedGpCents, "creditedGpCents");
  assertBps(rateBps, "rateBps");
  if (rateBps < 0) {
    throw new RangeError("rateBps can't be negative");
  }
  return Math.max(0, applyBps(creditedGpCents, rateBps));
}

/** Explains one commission line in plain English. */
export function explainCommissionLine(
  creditedGpCents: Cents,
  rateBps: Bps,
  levelName: string,
  jobLabel?: string,
): string {
  const amount = commissionLine(creditedGpCents, rateBps);
  const prefix = jobLabel ? `${jobLabel}: ` : "";
  if (creditedGpCents < 0) {
    return `${prefix}gross profit ${formatCents(creditedGpCents)} lowers your week score but never makes negative commission, so this line is ${formatCents(0)}.`;
  }
  return `${prefix}your credited gross profit ${formatCents(creditedGpCents)} × ${formatBps(rateBps)} (${levelName} week) = ${formatCents(amount)}.`;
}

export type CommissionLineResult = {
  jobId: string;
  creditedGpCents: Cents;
  rateBps: Bps;
  levelName: string;
  amountCents: Cents;
  explanation: string;
};

export type WeekCommission = {
  scoreCents: Cents;
  level: LadderStep;
  lines: CommissionLineResult[];
  totalCents: Cents;
  explanation: string;
};

/**
 * A tech's week: score (callbacks excluded), level, one commission line per job at the
 * week's rate, and the total. The rate applies to all of the week's GP.
 */
export function weekCommission(
  credits: readonly ScoredCredit[],
  ladder: readonly LadderStep[] = DEFAULT_LADDER,
): WeekCommission {
  credits.forEach((credit, index) => {
    assertText(credit.jobId, `credits[${index}].jobId`);
  });
  const scoreCents = weekScore(credits);
  const level = levelFor(scoreCents, ladder);
  const lines = credits
    .filter((credit) => !credit.isCallback)
    .map((credit) => ({
      jobId: credit.jobId,
      creditedGpCents: credit.creditedGpCents,
      rateBps: level.rateBps,
      levelName: level.levelName,
      amountCents: commissionLine(credit.creditedGpCents, level.rateBps),
      explanation: explainCommissionLine(
        credit.creditedGpCents,
        level.rateBps,
        level.levelName,
        `Job ${credit.jobId}`,
      ),
    }));
  const totalCents = sumCents(lines.map((line) => line.amountCents));
  return {
    scoreCents,
    level,
    lines,
    totalCents,
    explanation: `Week score ${formatCents(scoreCents)} puts you at ${level.levelName} (${formatBps(level.rateBps)} on every profit dollar this week). Commission ${formatCents(totalCents)}.`,
  };
}
