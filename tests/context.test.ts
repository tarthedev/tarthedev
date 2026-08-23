import { describe, expect, it } from "vitest";


import { buildPerformanceContext, fingerprintContext } from "@/lib/ai/context";
import { computePace } from "@/lib/kpi/pace";
import { buildWorkingCalendar } from "@/lib/kpi/schedule";
import { computeOverallScore } from "@/lib/kpi/scoring";
import { defaultSettings } from "@/lib/settings";

type Dashboard = Parameters<typeof buildPerformanceContext>[0];

const calendar = buildWorkingCalendar([], "calendar");

function row(key: string, displayName: string, current: number, target: number) {
  const pace = computePace({
    current,
    target,
    periodStart: "2026-08-16",
    periodEnd: "2026-08-22",
    today: "2026-08-21",
    calendar,
    todayCounted: true,
  });
  return {
    kpiId: key,
    key,
    displayName,
    category: null,
    unitType: "COUNT" as const,
    weight: 1,
    sortOrder: 0,
    aggregation: "LATEST" as const,
    goalId: target > 0 ? `${key}-goal` : null,
    periodType: "WEEKLY" as const,
    minimumValue: null,
    targetValue: target,
    stretchValue: null,
    priority: 0,
    current,
    lastObservedAt: null,
    observationCount: 3,
    pace,
    series: [],
    dailyProduction: [],
  };
}

function dashboard(overrides: Partial<Dashboard> = {}): Dashboard {
  const rows = [row("internet", "Internet", 7, 12), row("vmp", "VMP", 13, 15)];
  const reference = rows[0]!.pace;

  return {
    period: { type: "WEEKLY", start: "2026-08-16", end: "2026-08-22", label: "Aug 16 – Aug 22" },
    today: "2026-08-21",
    todayCounted: true,
    unitLabel: "day",
    unitsEngaged: reference.unitsEngaged,
    unitsRemaining: reference.unitsRemaining,
    unitsTotal: reference.unitsTotal,
    scheduledHoursRemaining: null,
    rows,
    overall: computeOverallScore(
      rows.map((r) => ({ key: r.key, displayName: r.displayName, weight: r.weight, pace: r.pace })),
    ),
    todayTargets: [],
    lastSnapshot: null,
    pendingReviewCount: 0,
    settings: defaultSettings(),
    timezone: "America/New_York",
    ...overrides,
  } as Dashboard;
}

describe("buildPerformanceContext", () => {
  it("includes every number the coach is allowed to quote", () => {
    const context = buildPerformanceContext(dashboard());

    expect(context).toContain("INTERNET (internet)");
    expect(context).toContain("current 7");
    expect(context).toContain("goal 12");
    expect(context).toContain("remaining 5");
    expect(context).toContain("required/day");
    expect(context).toContain("projected finish");
    expect(context).toContain("status Behind");
  });

  it("states explicitly whether today is already counted", () => {
    expect(buildPerformanceContext(dashboard())).toContain("TODAY ALREADY COUNTED: yes");
    expect(buildPerformanceContext(dashboard({ todayCounted: false }))).toContain(
      "TODAY ALREADY COUNTED: no",
    );
  });

  it("stays compact — this is the main lever on AI cost", () => {
    const context = buildPerformanceContext(dashboard());
    // Roughly 3.5 characters per token; a weekly context must stay well under
    // 1,000 tokens no matter how much history is stored.
    expect(context.length / 3.5).toBeLessThan(1000);
  });

  it("does not leak database identifiers into the prompt", () => {
    const context = buildPerformanceContext(dashboard());
    expect(context).not.toContain("kpiId");
    expect(context).not.toContain("goalId");
    expect(context).not.toContain("-goal");
  });

  it("says plainly when there is no data rather than implying zero performance", () => {
    const context = buildPerformanceContext(dashboard({ rows: [] }));
    expect(context).toContain("No KPI data has been confirmed");
  });
});

describe("fingerprintContext", () => {
  it("is stable for unchanged numbers, so a cached brief stays valid", () => {
    expect(fingerprintContext(dashboard())).toBe(fingerprintContext(dashboard()));
  });

  it("changes when a value changes, forcing regeneration", () => {
    const before = fingerprintContext(dashboard());
    const after = fingerprintContext(
      dashboard({ rows: [row("internet", "Internet", 9, 12), row("vmp", "VMP", 13, 15)] }),
    );
    expect(after).not.toBe(before);
  });

  it("changes when the period rolls over", () => {
    const before = fingerprintContext(dashboard());
    const after = fingerprintContext(
      dashboard({
        period: { type: "WEEKLY", start: "2026-08-23", end: "2026-08-29", label: "Aug 23 – Aug 29" },
      }),
    );
    expect(after).not.toBe(before);
  });
});
