import { z } from "zod";

/**
 * Wire schemas for structured model output.
 *
 * These are deliberately permissive about *types* — every constraint that could
 * make the API reject a schema is enforced afterwards in `normalizeExtraction`
 * instead. A model that returns a confidence of 1.4 should be clamped, not
 * crash the pipeline.
 */

export const ExtractedMetricSchema = z.object({
  /** Known KPI key when the label was recognised, otherwise null. */
  key: z.string().nullable(),
  display_name: z.string(),
  value: z.number(),
  /** The characters as printed on screen, before any parsing. */
  raw_text: z.string(),
  unit: z.enum(["count", "currency", "percent", "ratio"]).nullable(),
  confidence: z.number(),
  /** Label of the screenshot this reading came from, e.g. "screenshot_2". */
  source_image: z.string(),
  period_start: z.string().nullable(),
  period_end: z.string().nullable(),
  notes: z.string().nullable(),
});

export const UnreadableImageSchema = z.object({
  source_image: z.string(),
  reason: z.string(),
});

export const ExtractionResultSchema = z.object({
  reporting_period: z.object({
    start: z.string().nullable(),
    end: z.string().nullable(),
    label: z.string().nullable(),
    confidence: z.number(),
  }),
  metrics: z.array(ExtractedMetricSchema),
  unreadable_images: z.array(UnreadableImageSchema),
  notes: z.string().nullable(),
});

export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;
export type ExtractedMetricPayload = z.infer<typeof ExtractedMetricSchema>;

export const CoachPrioritySchema = z.object({
  action: z.string(),
  why: z.string(),
  impact: z.enum(["HIGH", "MEDIUM", "LOW"]),
});

export const CoachHighlightSchema = z.object({
  kpi: z.string(),
  reason: z.string(),
});

/**
 * The coach writes judgement and language only. Every number shown next to a
 * brief comes from the pace engine, so the model cannot invent a KPI value.
 */
export const CoachBriefSchema = z.object({
  overall_status: z.enum(["AHEAD", "ON_TRACK", "AT_RISK", "BEHIND"]),
  headline: z.string(),
  biggest_win: CoachHighlightSchema,
  biggest_problem: CoachHighlightSchema,
  priorities: z.array(CoachPrioritySchema),
  opportunity: z.string(),
  forecast: z.string(),
  one_thing: z.string(),
});

export type CoachBrief = z.infer<typeof CoachBriefSchema>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const clampConfidence = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
};

const cleanDate = (value: string | null): string | null =>
  value && ISO_DATE.test(value.trim()) ? value.trim() : null;

/**
 * Post-parse hardening. Applied to every extraction regardless of which model
 * or provider produced it.
 */
export function normalizeExtraction(result: ExtractionResult): ExtractionResult {
  return {
    reporting_period: {
      start: cleanDate(result.reporting_period.start),
      end: cleanDate(result.reporting_period.end),
      label: result.reporting_period.label?.trim() || null,
      confidence: clampConfidence(result.reporting_period.confidence),
    },
    metrics: result.metrics
      .filter((m) => Number.isFinite(m.value) && m.display_name.trim().length > 0)
      .map((m) => ({
        ...m,
        key: m.key?.trim() || null,
        display_name: m.display_name.trim(),
        raw_text: m.raw_text.trim(),
        confidence: clampConfidence(m.confidence),
        period_start: cleanDate(m.period_start),
        period_end: cleanDate(m.period_end),
        notes: m.notes?.trim() || null,
      })),
    unreadable_images: result.unreadable_images,
    notes: result.notes?.trim() || null,
  };
}
