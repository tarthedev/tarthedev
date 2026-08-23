import { describe, expect, it } from "vitest";
import { ExtractionResultSchema, normalizeExtraction } from "@/lib/ai/schemas";
import { matchKpi, normalizeKey, parseNumericValue } from "@/lib/kpi/normalize";
import { confidenceBand, needsReview, validateValue } from "@/lib/kpi/validate";

const KPIS = [
  { id: "1", key: "internet", displayName: "Internet", aliases: ["Home Internet", "FWA"] },
  { id: "2", key: "vmp", displayName: "VMP", aliases: ["Verizon Mobile Protect"] },
  { id: "3", key: "new_lines", displayName: "New Lines", aliases: [] },
];

describe("normalizeKey", () => {
  it("produces stable machine keys from display labels", () => {
    expect(normalizeKey("Internet")).toBe("internet");
    expect(normalizeKey("New Lines")).toBe("new_lines");
    expect(normalizeKey("  Accessory  Attach! ")).toBe("accessory_attach");
    expect(normalizeKey("VMP %")).toBe("vmp");
    expect(normalizeKey("Rep's Total")).toBe("reps_total");
  });

  it("returns an empty string when nothing usable remains", () => {
    expect(normalizeKey("!!!")).toBe("");
  });
});

describe("matchKpi", () => {
  it("prefers an exact key echoed by the model", () => {
    expect(matchKpi({ key: "internet", label: "Something else" }, KPIS)?.key).toBe("internet");
  });

  it("matches by display name and alias", () => {
    expect(matchKpi({ key: null, label: "Internet" }, KPIS)?.key).toBe("internet");
    expect(matchKpi({ key: null, label: "Home Internet" }, KPIS)?.key).toBe("internet");
    expect(matchKpi({ key: null, label: "Verizon Mobile Protect" }, KPIS)?.key).toBe("vmp");
  });

  it("matches loosely on spacing and punctuation", () => {
    expect(matchKpi({ key: null, label: "new lines" }, KPIS)?.key).toBe("new_lines");
    expect(matchKpi({ key: null, label: "NEW-LINES" }, KPIS)?.key).toBe("new_lines");
  });

  it("returns null rather than guessing at an unknown label", () => {
    // An unknown KPI must reach the user as a decision, not a silent mapping.
    expect(matchKpi({ key: null, label: "Perks" }, KPIS)).toBeNull();
    expect(matchKpi({ key: null, label: "" }, KPIS)).toBeNull();
    expect(matchKpi({ key: null, label: null }, KPIS)).toBeNull();
  });
});

describe("parseNumericValue", () => {
  it("parses the formats a dashboard actually prints", () => {
    expect(parseNumericValue("7")).toBe(7);
    expect(parseNumericValue("1,234")).toBe(1234);
    expect(parseNumericValue("87%")).toBe(87);
    expect(parseNumericValue("$1,299.50")).toBe(1299.5);
    expect(parseNumericValue("  12  ")).toBe(12);
  });

  it("takes the numerator from a progress reading", () => {
    expect(parseNumericValue("7 / 12")).toBe(7);
    expect(parseNumericValue("7 of 12")).toBe(7);
  });

  it("rejects anything that is not a number", () => {
    expect(parseNumericValue("N/A")).toBeNull();
    expect(parseNumericValue("")).toBeNull();
    expect(parseNumericValue("12abc")).toBeNull();
  });
});

describe("validateValue", () => {
  it("rejects impossible values", () => {
    expect(validateValue(-5).severity).toBe("error");
    expect(validateValue(Number.NaN).severity).toBe("error");
    expect(validateValue(Number.POSITIVE_INFINITY).severity).toBe("error");
  });

  it("warns rather than blocks on suspicious values", () => {
    expect(validateValue(7.5, "COUNT").severity).toBe("warn");
    expect(validateValue(250, "PERCENT").severity).toBe("warn");
    expect(validateValue(50_000, "COUNT").severity).toBe("warn");
  });

  it("accepts ordinary values", () => {
    expect(validateValue(7, "COUNT").severity).toBe("ok");
    expect(validateValue(1299.5, "CURRENCY").severity).toBe("ok");
    expect(validateValue(0, "COUNT").severity).toBe("ok");
  });
});

describe("confidence banding", () => {
  it("bands scores the way the UI describes them", () => {
    expect(confidenceBand(0.99)).toBe("high");
    expect(confidenceBand(0.9)).toBe("good");
    expect(confidenceBand(0.75)).toBe("uncertain");
    expect(confidenceBand(0.62)).toBe("questionable");
  });

  it("routes to review below the threshold or on any validation issue", () => {
    const ok = { severity: "ok" as const };
    expect(needsReview(0.95, 0.8, ok)).toBe(false);
    expect(needsReview(0.62, 0.8, ok)).toBe(true);
    // A confident but implausible value still needs a human.
    expect(needsReview(0.99, 0.8, { severity: "warn", message: "odd" })).toBe(true);
  });
});

describe("normalizeExtraction", () => {
  const base = {
    reporting_period: { start: null, end: null, label: null, confidence: 0.5 },
    metrics: [],
    unreadable_images: [],
    notes: null,
  };

  it("clamps out-of-range confidence rather than trusting the model", () => {
    const result = normalizeExtraction({
      ...base,
      reporting_period: { ...base.reporting_period, confidence: 1.7 },
      metrics: [
        {
          key: "internet",
          display_name: "Internet",
          value: 7,
          raw_text: "7",
          unit: "count",
          confidence: 1.4,
          source_image: "screenshot_1",
          period_start: null,
          period_end: null,
          notes: null,
        },
      ],
    });

    expect(result.reporting_period.confidence).toBe(1);
    expect(result.metrics[0]?.confidence).toBe(1);
  });

  it("drops readings with no usable value or label", () => {
    const result = normalizeExtraction({
      ...base,
      metrics: [
        { key: null, display_name: "  ", value: 3, raw_text: "3", unit: null, confidence: 0.9, source_image: "s1", period_start: null, period_end: null, notes: null },
        { key: null, display_name: "Good", value: Number.NaN, raw_text: "?", unit: null, confidence: 0.9, source_image: "s1", period_start: null, period_end: null, notes: null },
        { key: null, display_name: "Keep", value: 4, raw_text: "4", unit: null, confidence: 0.9, source_image: "s1", period_start: null, period_end: null, notes: null },
      ],
    });

    expect(result.metrics).toHaveLength(1);
    expect(result.metrics[0]?.display_name).toBe("Keep");
  });

  it("discards malformed dates instead of storing them", () => {
    const result = normalizeExtraction({
      ...base,
      reporting_period: { start: "August 16", end: "2026-08-22", label: " Week ", confidence: 0.8 },
    });

    expect(result.reporting_period.start).toBeNull();
    expect(result.reporting_period.end).toBe("2026-08-22");
    expect(result.reporting_period.label).toBe("Week");
  });
});

describe("ExtractionResultSchema", () => {
  it("rejects a payload missing required fields", () => {
    expect(ExtractionResultSchema.safeParse({ metrics: [] }).success).toBe(false);
  });

  it("rejects a metric whose value is not a number", () => {
    const result = ExtractionResultSchema.safeParse({
      reporting_period: { start: null, end: null, label: null, confidence: 0.9 },
      metrics: [
        {
          key: null,
          display_name: "Internet",
          value: "seven",
          raw_text: "seven",
          unit: null,
          confidence: 0.9,
          source_image: "screenshot_1",
          period_start: null,
          period_end: null,
          notes: null,
        },
      ],
      unreadable_images: [],
      notes: null,
    });
    expect(result.success).toBe(false);
  });

  it("accepts a well-formed payload", () => {
    const result = ExtractionResultSchema.safeParse({
      reporting_period: { start: "2026-08-16", end: "2026-08-22", label: "Week", confidence: 0.9 },
      metrics: [
        {
          key: "internet",
          display_name: "Internet",
          value: 7,
          raw_text: "7 / 12",
          unit: "count",
          confidence: 0.97,
          source_image: "screenshot_1",
          period_start: null,
          period_end: null,
          notes: null,
        },
      ],
      unreadable_images: [{ source_image: "screenshot_3", reason: "blurred" }],
      notes: null,
    });
    expect(result.success).toBe(true);
  });
});
