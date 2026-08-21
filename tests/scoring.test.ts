import { describe, expect, it } from "vitest";
import { computePace, type PaceResult } from "@/lib/kpi/pace";
import { buildWorkingCalendar } from "@/lib/kpi/schedule";
import { computeOverallScore } from "@/lib/kpi/scoring";

const calendar = buildWorkingCalendar([], "calendar");

function paceFor(current: number, target: number): PaceResult {
  return computePace({
    current,
    target,
    periodStart: "2026-08-01",
    periodEnd: "2026-08-10",
    today: "2026-08-05",
    calendar,
    todayCounted: true,
  });
}

describe("computeOverallScore", () => {
  it("weights attainment rather than averaging raw values", () => {
    // Raw averaging would be meaningless: 5 Internet and 500 dollars of
    // accessories are not comparable numbers.
    const score = computeOverallScore([
      { key: "internet", displayName: "Internet", weight: 3, pace: paceFor(5, 10) }, // 50%
      { key: "accessories", displayName: "Accessories", weight: 1, pace: paceFor(500, 500) }, // 100%
    ]);

    // (50 × 0.75) + (100 × 0.25) = 62.5
    expect(score.score).toBe(62.5);
    expect(score.totalWeight).toBe(4);
  });

  it("caps a runaway KPI so it cannot mask a miss", () => {
    const score = computeOverallScore(
      [
        { key: "easy", displayName: "Easy", weight: 1, pace: paceFor(40, 10) }, // 400%
        { key: "hard", displayName: "Hard", weight: 1, pace: paceFor(0, 10) }, // 0%
      ],
      { capAttainmentPct: 150 },
    );

    // Uncapped this would read 200%. Capped: (150 + 0) / 2 = 75.
    expect(score.score).toBe(75);
    expect(score.components.find((c) => c.key === "easy")?.capped).toBe(true);
    expect(score.components.find((c) => c.key === "hard")?.capped).toBe(false);
  });

  it("ignores KPIs with no goal or no weight", () => {
    const score = computeOverallScore([
      { key: "a", displayName: "A", weight: 1, pace: paceFor(5, 10) },
      { key: "no-goal", displayName: "No goal", weight: 1, pace: paceFor(9, 0) },
      { key: "no-weight", displayName: "No weight", weight: 0, pace: paceFor(1, 10) },
    ]);

    expect(score.components).toHaveLength(1);
    expect(score.score).toBe(50);
  });

  it("returns a safe zero when nothing is scoreable", () => {
    const score = computeOverallScore([]);
    expect(score.score).toBe(0);
    expect(score.components).toEqual([]);
    expect(score.formula).toContain("No weighted KPIs");
  });

  it("normalises weights so they need not sum to 100", () => {
    const score = computeOverallScore([
      { key: "a", displayName: "A", weight: 7, pace: paceFor(10, 10) },
      { key: "b", displayName: "B", weight: 3, pace: paceFor(0, 10) },
    ]);

    expect(score.score).toBe(70);
    expect(score.components[0]?.normalizedWeight).toBeCloseTo(0.7, 4);
  });

  it("publishes a formula that reproduces the score", () => {
    const score = computeOverallScore([
      { key: "a", displayName: "A", weight: 1, pace: paceFor(8, 10) },
      { key: "b", displayName: "B", weight: 1, pace: paceFor(6, 10) },
    ]);
    expect(score.formula).toContain("A 80%");
    expect(score.formula).toContain("B 60%");
    expect(score.formula).toContain("70.0%");
  });
});
