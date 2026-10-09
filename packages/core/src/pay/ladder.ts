/**
 * The Profit Ladder (docs/02-commission-plan.md section 4).
 * Thresholds are inclusive; the rate applies to all of the week's GP (whole-week jump).
 */

import { assertNonNegativeInt, assertText } from "../internal/int";
import { assertCents, BPS_SCALE, type Bps, type Cents, sumCents } from "../money";

export type LadderStep = {
  levelName: string;
  /** Lowest week score (inclusive) that reaches this level. */
  minWeekGpCents: Cents;
  rateBps: Bps;
};

/** The starting ladder. Real values come from dated `ladder_steps` settings. */
export const DEFAULT_LADDER: readonly LadderStep[] = Object.freeze([
  Object.freeze({ levelName: "Starter", minWeekGpCents: 0, rateBps: 500 }),
  Object.freeze({ levelName: "Bronze", minWeekGpCents: 300_000, rateBps: 800 }),
  Object.freeze({ levelName: "Silver", minWeekGpCents: 450_000, rateBps: 1_000 }),
  Object.freeze({ levelName: "Gold", minWeekGpCents: 600_000, rateBps: 1_200 }),
  Object.freeze({ levelName: "Platinum", minWeekGpCents: 800_000, rateBps: 1_400 }),
]);

/** Validates a ladder and returns its steps sorted from lowest to highest threshold. */
export function validateLadder(ladder: readonly LadderStep[]): LadderStep[] {
  if (ladder.length === 0) {
    throw new RangeError("The ladder needs at least one step");
  }
  const sorted = [...ladder].sort((a, b) => a.minWeekGpCents - b.minWeekGpCents);
  sorted.forEach((step, index) => {
    assertText(step.levelName, `ladder[${index}].levelName`);
    assertCents(step.minWeekGpCents, `ladder[${index}].minWeekGpCents`);
    assertNonNegativeInt(step.rateBps, `ladder[${index}].rateBps`);
    if (step.rateBps > BPS_SCALE) {
      throw new RangeError(`ladder[${index}].rateBps can't exceed 100%`);
    }
    const previous = sorted[index - 1];
    if (previous && previous.minWeekGpCents === step.minWeekGpCents) {
      throw new RangeError(`Two ladder steps start at the same score (${step.minWeekGpCents})`);
    }
  });
  return sorted;
}

/**
 * The level for a week score: the highest step whose threshold is at or below the score.
 * A score below the lowest step (a negative week) gets the lowest step.
 */
export function levelFor(
  weekScoreCents: Cents,
  ladder: readonly LadderStep[] = DEFAULT_LADDER,
): LadderStep {
  assertCents(weekScoreCents, "weekScoreCents");
  const sorted = validateLadder(ladder);
  let level = sorted[0] as LadderStep;
  for (const step of sorted) {
    if (weekScoreCents >= step.minWeekGpCents) level = step;
  }
  return level;
}

/**
 * The next level up and how much more GP reaches it, or null at the top.
 * A negative week is already on the lowest step (see `levelFor`), so its next level is the
 * step above that one.
 */
export function nextLevel(
  weekScoreCents: Cents,
  ladder: readonly LadderStep[] = DEFAULT_LADDER,
): { step: LadderStep; neededCents: Cents } | null {
  assertCents(weekScoreCents, "weekScoreCents");
  const sorted = validateLadder(ladder);
  const current = levelFor(weekScoreCents, sorted);
  const step = sorted.find(
    (candidate) =>
      candidate.minWeekGpCents > current.minWeekGpCents &&
      candidate.minWeekGpCents > weekScoreCents,
  );
  return step ? { step, neededCents: step.minWeekGpCents - weekScoreCents } : null;
}

export type ScoredCredit = {
  jobId: string;
  creditedGpCents: Cents;
  /** Callback and warranty visits are excluded from week scores. */
  isCallback?: boolean;
};

/** Week score: the sum of a tech's credited GP for jobs finished that week, negatives included, callbacks excluded. */
export function weekScore(credits: readonly ScoredCredit[]): Cents {
  return sumCents(
    credits.filter((credit) => !credit.isCallback).map((credit) => credit.creditedGpCents),
  );
}
