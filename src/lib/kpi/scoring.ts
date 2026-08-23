import type { PaceResult } from "@/lib/kpi/pace";

export interface ScoreInput {
  key: string;
  displayName: string;
  weight: number;
  pace: PaceResult;
}

export interface ScoreComponent {
  key: string;
  displayName: string;
  weight: number;
  /** Share of the final score this KPI is responsible for, 0–1. */
  normalizedWeight: number;
  attainmentPct: number;
  /** Attainment after the cap is applied. */
  effectiveAttainmentPct: number;
  capped: boolean;
  contribution: number;
}

export interface OverallScore {
  score: number;
  components: ScoreComponent[];
  totalWeight: number;
  cap: number;
  /** Human-readable formula so the number is never a black box. */
  formula: string;
}

export interface ScoringOptions {
  /**
   * Ceiling on a single KPI's attainment. Without it, 400% on an easy KPI hides
   * a miss on a hard one. 150 means "a KPI can carry at most 1.5×".
   */
  capAttainmentPct?: number;
}

/**
 * Weighted goal attainment across KPIs. Raw KPI values are never averaged —
 * different KPIs have different goals, so only attainment is comparable.
 */
export function computeOverallScore(inputs: ScoreInput[], options: ScoringOptions = {}): OverallScore {
  const cap = options.capAttainmentPct ?? 150;
  const scored = inputs.filter((i) => i.pace.target > 0 && i.weight > 0);
  const totalWeight = scored.reduce((sum, i) => sum + i.weight, 0);

  if (scored.length === 0 || totalWeight <= 0) {
    return {
      score: 0,
      components: [],
      totalWeight: 0,
      cap,
      formula: "No weighted KPIs with an active goal.",
    };
  }

  const components: ScoreComponent[] = scored.map((i) => {
    const attainmentPct = i.pace.attainmentPct;
    const effective = Math.min(attainmentPct, cap);
    const normalizedWeight = i.weight / totalWeight;
    return {
      key: i.key,
      displayName: i.displayName,
      weight: i.weight,
      normalizedWeight: Math.round(normalizedWeight * 10000) / 10000,
      attainmentPct,
      effectiveAttainmentPct: Math.round(effective * 100) / 100,
      capped: attainmentPct > cap,
      contribution: Math.round(effective * normalizedWeight * 100) / 100,
    };
  });

  const score = Math.round(components.reduce((sum, c) => sum + c.contribution, 0) * 100) / 100;

  const formula = components
    .map((c) => `${c.displayName} ${c.effectiveAttainmentPct.toFixed(0)}% × ${(c.normalizedWeight * 100).toFixed(0)}%`)
    .join("  +  ");

  return { score, components, totalWeight, cap, formula: `${formula}  =  ${score.toFixed(1)}%` };
}
