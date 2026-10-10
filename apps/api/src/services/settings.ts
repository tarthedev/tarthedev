import { type LocalDate, pickEffective } from "@dwrg/core";
import { type Executor, settings } from "@dwrg/db";
import { DEFAULT_REPLACEMENT_AGE_YEARS } from "@dwrg/shared";
import { and, eq, gt, isNull, lte, or } from "drizzle-orm";

/**
 * Effective-dated settings (CLAUDE.md rule 7): the row whose
 * [effective_from, effective_to) range covers `on`, a business-local date.
 * Returns undefined when no row is in effect.
 */
export async function settingOn(db: Executor, key: string, on: LocalDate): Promise<unknown> {
  const rows = await db
    .select({
      value: settings.value,
      effectiveFrom: settings.effectiveFrom,
      effectiveTo: settings.effectiveTo,
    })
    .from(settings)
    .where(
      and(
        eq(settings.key, key),
        lte(settings.effectiveFrom, on),
        or(isNull(settings.effectiveTo), gt(settings.effectiveTo, on)),
      ),
    );
  return pickEffective(rows, on)?.value;
}

/**
 * Equipment older than this many years raises the replacement flag on the
 * customer file (docs/01-operations.md, Phones: "older than 15 years (setting)").
 * Value: a whole number of years, or { "years": n }.
 */
export const REPLACEMENT_AGE_SETTING_KEY = "replacement_flag_age_years";

export async function replacementAgeYears(db: Executor, on: LocalDate): Promise<number> {
  const value = await settingOn(db, REPLACEMENT_AGE_SETTING_KEY, on);
  const years =
    typeof value === "number"
      ? value
      : typeof value === "object" && value !== null
        ? (value as { years?: unknown }).years
        : undefined;
  return typeof years === "number" && Number.isInteger(years) && years >= 1 && years <= 100
    ? years
    : DEFAULT_REPLACEMENT_AGE_YEARS;
}
