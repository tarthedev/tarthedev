import type { DateKey } from "@/lib/kpi/dates";

export interface ExtractedMetric {
  /** Key echoed by the model, when it recognised a known KPI. */
  key: string | null;
  label: string;
  value: number;
  unit: string | null;
  confidence: number;
  sourceImage: string;
  periodStart?: DateKey | null;
  periodEnd?: DateKey | null;
}

export interface ConflictReading {
  value: number;
  confidence: number;
  sourceImage: string;
  periodStart?: DateKey | null;
  periodEnd?: DateKey | null;
}

export type ConflictReason = "DIFFERENT_VALUES" | "DIFFERENT_PERIODS";

export interface ConflictGroup {
  /** Grouping identifier: the KPI key when known, otherwise the raw label. */
  groupKey: string;
  label: string;
  reason: ConflictReason;
  readings: ConflictReading[];
  /** Reading the system would pick, shown as a suggestion — never auto-applied. */
  suggested: ConflictReading;
}

export interface ReconcileResult {
  /** One reading per KPI, safe to persist as-is. */
  agreed: ExtractedMetric[];
  /** Groups needing a human decision. */
  conflicts: ConflictGroup[];
}

const groupIdOf = (m: ExtractedMetric): string => m.key ?? `label:${m.label.trim().toLowerCase()}`;

const samePeriod = (a: ExtractedMetric, b: ExtractedMetric): boolean =>
  (a.periodStart ?? null) === (b.periodStart ?? null) && (a.periodEnd ?? null) === (b.periodEnd ?? null);

/**
 * Groups readings by KPI and separates agreement from disagreement.
 *
 * When two screenshots report the same KPI with different numbers, the system
 * refuses to pick for you. It surfaces both readings with their source images
 * and confidence so you can decide — the screenshots may simply have been taken
 * at different times.
 */
export function reconcileMetrics(metrics: ExtractedMetric[]): ReconcileResult {
  const groups = new Map<string, ExtractedMetric[]>();
  for (const metric of metrics) {
    const id = groupIdOf(metric);
    const bucket = groups.get(id);
    if (bucket) bucket.push(metric);
    else groups.set(id, [metric]);
  }

  const agreed: ExtractedMetric[] = [];
  const conflicts: ConflictGroup[] = [];

  for (const [groupKey, readings] of groups) {
    const first = readings[0];
    if (!first) continue;

    if (readings.length === 1) {
      agreed.push(first);
      continue;
    }

    const distinctValues = new Set(readings.map((r) => r.value));
    const periodsMatch = readings.every((r) => samePeriod(r, first));

    if (distinctValues.size === 1 && periodsMatch) {
      // Same number seen on several screens — keep the most confident reading.
      const best = readings.reduce((a, b) => (b.confidence > a.confidence ? b : a));
      agreed.push(best);
      continue;
    }

    const sorted = [...readings].sort((a, b) => b.confidence - a.confidence || b.value - a.value);
    const suggestedSource = sorted[0] ?? first;
    conflicts.push({
      groupKey,
      label: first.label,
      reason: distinctValues.size > 1 ? "DIFFERENT_VALUES" : "DIFFERENT_PERIODS",
      readings: readings.map((r) => ({
        value: r.value,
        confidence: r.confidence,
        sourceImage: r.sourceImage,
        periodStart: r.periodStart ?? null,
        periodEnd: r.periodEnd ?? null,
      })),
      suggested: {
        value: suggestedSource.value,
        confidence: suggestedSource.confidence,
        sourceImage: suggestedSource.sourceImage,
        periodStart: suggestedSource.periodStart ?? null,
        periodEnd: suggestedSource.periodEnd ?? null,
      },
    });
  }

  return { agreed, conflicts };
}
