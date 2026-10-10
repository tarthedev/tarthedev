/**
 * Column mappings are config: each report type lists its fields and, for each
 * field, the ServiceTitan column headers that mean it. When DWRG's real
 * exports arrive, add their header names here; no code changes needed.
 *
 * Header matching ignores case, spacing and punctuation, and "#" reads as
 * "number", so "Job #", "job number" and "JOB  NUMBER" all match "Job #".
 * The first header listed is the one the demo exports use.
 */

export const REPORT_TYPES = [
  "technicians",
  "pricebook",
  "customers",
  "equipment",
  "memberships",
  "invoices",
  "payments",
  "timesheets",
] as const;
/** Report types, listed in the order a full import runs them (later ones refer to earlier ones). */
export type ReportType = (typeof REPORT_TYPES)[number];

export function isReportType(value: unknown): value is ReportType {
  return typeof value === "string" && (REPORT_TYPES as readonly string[]).includes(value);
}

export interface FieldSpec {
  /** Column headers that mean this field, most likely first. */
  headers: readonly string[];
  /** The column must be in the file (the cell may still be blank unless the field needs a value). */
  required?: boolean;
  /** Read only to recognize the report or for people reading the preview; not stored. */
  informational?: boolean;
}

export interface ReportMapping<F extends string = string> {
  type: ReportType;
  /** Name shown on the Import page. */
  label: string;
  /** What one row of the export is. */
  rowMeaning: string;
  fields: Readonly<Record<F, FieldSpec>>;
}

/** Field names of a mapping. */
export type FieldOf<M> = M extends ReportMapping<infer F> ? F : never;

export function defineMapping<F extends string>(mapping: ReportMapping<F>): ReportMapping<F> {
  return mapping;
}

/** Lower-case, "#" as "number", and anything but letters and digits as one space. */
export function normalizeLabel(value: string): string {
  return value
    .toLowerCase()
    .replaceAll("#", " number ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
