import type { UnitType } from "@/lib/kpi/pace";

export type ValidationSeverity = "ok" | "warn" | "error";

export interface ValueValidation {
  severity: ValidationSeverity;
  message?: string;
}

/**
 * Plausibility check applied to every extracted number before it can be
 * accepted. This is the last line of defence against an OCR slip turning
 * "8" into "-5" or "800000".
 */
export function validateValue(
  value: number,
  unitType: UnitType = "COUNT",
  options: { allowNegative?: boolean; softMax?: number } = {},
): ValueValidation {
  if (!Number.isFinite(value)) {
    return { severity: "error", message: "Value is not a finite number." };
  }
  if (value < 0 && !options.allowNegative) {
    return { severity: "error", message: "Negative values are not valid for this KPI." };
  }
  if (unitType === "COUNT" && !Number.isInteger(value)) {
    return { severity: "warn", message: "Count KPIs are normally whole numbers." };
  }
  if (unitType === "PERCENT" && value > 200) {
    return { severity: "warn", message: "Percentage above 200% — check the screenshot." };
  }

  const softMax = options.softMax ?? (unitType === "CURRENCY" ? 1_000_000 : 10_000);
  if (value > softMax) {
    return {
      severity: "warn",
      message: `Unusually large for this KPI (over ${softMax.toLocaleString()}). Worth a second look.`,
    };
  }
  return { severity: "ok" };
}

export type ConfidenceBand = "high" | "good" | "uncertain" | "questionable";

export function confidenceBand(confidence: number): ConfidenceBand {
  if (confidence >= 0.95) return "high";
  if (confidence >= 0.85) return "good";
  if (confidence >= 0.7) return "uncertain";
  return "questionable";
}

/** Below the configured threshold a value must be reviewed before it counts. */
export function needsReview(
  confidence: number,
  threshold: number,
  validation: ValueValidation,
): boolean {
  return confidence < threshold || validation.severity !== "ok";
}
