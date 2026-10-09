/**
 * Effective-dated settings. A row applies from `effectiveFrom` (inclusive) up to
 * `effectiveTo` (exclusive; null or missing means open-ended). When several rows apply,
 * the one with the latest `effectiveFrom` wins, so adding a new dated row changes the
 * future without rewriting history.
 */

import { assertLocalDate, compareLocalDates, type LocalDate } from "../time/weeks";

export type EffectiveDated = {
  effectiveFrom: LocalDate;
  effectiveTo?: LocalDate | null;
};

function activeOn<T extends EffectiveDated>(rows: readonly T[], on: LocalDate): T[] {
  assertLocalDate(on, "on");
  return rows.filter((row, index) => {
    assertLocalDate(row.effectiveFrom, `rows[${index}].effectiveFrom`);
    if (row.effectiveTo != null) {
      assertLocalDate(row.effectiveTo, `rows[${index}].effectiveTo`);
      if (compareLocalDates(row.effectiveTo, row.effectiveFrom) <= 0) {
        throw new RangeError(
          `rows[${index}] ends (${row.effectiveTo}) on or before it starts (${row.effectiveFrom})`,
        );
      }
    }
    const started = compareLocalDates(row.effectiveFrom, on) <= 0;
    const notEnded = row.effectiveTo == null || compareLocalDates(on, row.effectiveTo) < 0;
    return started && notEnded;
  });
}

function latestStart<T extends EffectiveDated>(rows: readonly T[]): LocalDate | undefined {
  let latest: LocalDate | undefined;
  for (const row of rows) {
    if (latest === undefined || compareLocalDates(row.effectiveFrom, latest) > 0) {
      latest = row.effectiveFrom;
    }
  }
  return latest;
}

/**
 * The single row in effect on `on`, or undefined when none is.
 * Throws when two rows with the same `effectiveFrom` both apply (ambiguous settings).
 */
export function pickEffective<T extends EffectiveDated>(
  rows: readonly T[],
  on: LocalDate,
): T | undefined {
  const group = pickEffectiveGroup(rows, on);
  if (group.length > 1) {
    throw new RangeError(
      `${group.length} settings rows start on ${group[0]?.effectiveFrom} and all apply on ${on}`,
    );
  }
  return group[0];
}

/** Like `pickEffective`, but throws when nothing is in effect. */
export function requireEffective<T extends EffectiveDated>(
  rows: readonly T[],
  on: LocalDate,
  what = "setting",
): T {
  const row = pickEffective(rows, on);
  if (!row) {
    throw new RangeError(`No ${what} is in effect on ${on}`);
  }
  return row;
}

/**
 * Every row of the version in effect on `on`: the applicable rows that share the latest
 * `effectiveFrom`. Use this for multi-row settings such as the ladder's steps.
 */
export function pickEffectiveGroup<T extends EffectiveDated>(
  rows: readonly T[],
  on: LocalDate,
): T[] {
  const active = activeOn(rows, on);
  const start = latestStart(active);
  if (start === undefined) return [];
  return active.filter((row) => row.effectiveFrom === start);
}
