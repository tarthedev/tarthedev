import { describe, expect, it } from "vitest";
import { reconcileMetrics, type ExtractedMetric } from "@/lib/kpi/conflicts";

function metric(overrides: Partial<ExtractedMetric> = {}): ExtractedMetric {
  return {
    key: "internet",
    label: "Internet",
    value: 7,
    unit: "count",
    confidence: 0.95,
    sourceImage: "screenshot_1",
    ...overrides,
  };
}

describe("reconcileMetrics", () => {
  it("passes through a single reading", () => {
    const { agreed, conflicts } = reconcileMetrics([metric()]);
    expect(agreed).toHaveLength(1);
    expect(conflicts).toHaveLength(0);
  });

  it("merges identical readings from different screenshots", () => {
    const { agreed, conflicts } = reconcileMetrics([
      metric({ sourceImage: "screenshot_1", confidence: 0.9 }),
      metric({ sourceImage: "screenshot_2", confidence: 0.98 }),
    ]);

    expect(conflicts).toHaveLength(0);
    expect(agreed).toHaveLength(1);
    // Keeps the more confident reading of the two.
    expect(agreed[0]?.confidence).toBe(0.98);
  });

  it("flags disagreement instead of silently picking a value", () => {
    const { agreed, conflicts } = reconcileMetrics([
      metric({ value: 7, sourceImage: "screenshot_1" }),
      metric({ value: 8, sourceImage: "screenshot_2" }),
    ]);

    expect(agreed).toHaveLength(0);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.reason).toBe("DIFFERENT_VALUES");
    expect(conflicts[0]?.readings.map((r) => r.value).sort()).toEqual([7, 8]);
  });

  it("suggests the most confident reading without applying it", () => {
    const { conflicts } = reconcileMetrics([
      metric({ value: 7, confidence: 0.7, sourceImage: "screenshot_1" }),
      metric({ value: 8, confidence: 0.99, sourceImage: "screenshot_2" }),
    ]);

    expect(conflicts[0]?.suggested.value).toBe(8);
    expect(conflicts[0]?.suggested.sourceImage).toBe("screenshot_2");
  });

  it("flags the same value reported for different periods", () => {
    const { conflicts } = reconcileMetrics([
      metric({ value: 7, periodStart: "2026-08-16", periodEnd: "2026-08-22" }),
      metric({ value: 7, periodStart: "2026-08-09", periodEnd: "2026-08-15", sourceImage: "screenshot_2" }),
    ]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.reason).toBe("DIFFERENT_PERIODS");
  });

  it("keeps unrelated KPIs in separate groups", () => {
    const { agreed, conflicts } = reconcileMetrics([
      metric({ key: "internet", label: "Internet", value: 7 }),
      metric({ key: "vmp", label: "VMP", value: 13 }),
      metric({ key: "smb", label: "SMB", value: 3 }),
    ]);

    expect(agreed).toHaveLength(3);
    expect(conflicts).toHaveLength(0);
  });

  it("groups unrecognised labels case-insensitively", () => {
    const { agreed, conflicts } = reconcileMetrics([
      metric({ key: null, label: "Perks", value: 4 }),
      metric({ key: null, label: "perks ", value: 5, sourceImage: "screenshot_2" }),
    ]);

    expect(agreed).toHaveLength(0);
    expect(conflicts).toHaveLength(1);
  });

  it("handles an empty batch", () => {
    expect(reconcileMetrics([])).toEqual({ agreed: [], conflicts: [] });
  });
});
