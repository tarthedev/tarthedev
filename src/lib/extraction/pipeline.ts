import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getStorage } from "@/lib/storage";
import { getSettings } from "@/lib/settings";
import { describeAiError } from "@/lib/ai/anthropic";
import { checkBudget } from "@/lib/ai/budget";
import { getAiProvider } from "@/lib/ai/provider";
import { recordAiFailure, recordAiRequest } from "@/lib/ai/usage";
import type { ExtractionResult } from "@/lib/ai/schemas";
import type { AiResult, ExtractKpisRequest } from "@/lib/ai/types";
import { reconcileMetrics, type ExtractedMetric } from "@/lib/kpi/conflicts";
import { dateKeyToUtc, todayInTz } from "@/lib/kpi/dates";
import { matchKpi } from "@/lib/kpi/normalize";
import { needsReview, validateValue } from "@/lib/kpi/validate";
import type { ExtractionStrategy, ObservationStatus } from "@/generated/prisma";

export interface ProcessResult {
  snapshotId: string;
  status: "CONFIRMED" | "NEEDS_REVIEW" | "FAILED";
  metricsExtracted: number;
  autoAccepted: number;
  needsReviewCount: number;
  conflictCount: number;
  unmappedCount: number;
  model: string;
  attempts: number;
  costUsd: number;
  message: string;
  budgetWarning: string | null;
}

interface LadderStep {
  strategy: ExtractionStrategy;
  escalate: boolean;
}

/**
 * The retry ladder. Each rung changes exactly one thing, so a failure at the end
 * says something specific about why extraction did not work.
 *
 * Escalating to the expensive model is the last rung, never the first — and a
 * merely low-confidence reading does not trigger it. Low confidence goes to
 * human review, which is both cheaper and more reliable than asking a second
 * model to guess at the same pixels.
 */
const LADDER: LadderStep[] = [
  { strategy: "STANDARD", escalate: false },
  { strategy: "EXPLICIT", escalate: false },
  { strategy: "EXPLICIT", escalate: true },
];

export async function processSnapshot(
  userId: string,
  snapshotId: string,
  timezone: string,
  options: { forceEscalation?: boolean } = {},
): Promise<ProcessResult> {
  const settings = await getSettings(userId);
  const config = env();

  const snapshot = await prisma.snapshot.findFirst({
    where: { id: snapshotId, userId },
    include: { images: { orderBy: { orderIndex: "asc" } } },
  });
  if (!snapshot) throw new Error("Snapshot not found.");
  if (snapshot.images.length === 0) throw new Error("This snapshot has no screenshots to process.");

  await prisma.snapshot.update({
    where: { id: snapshotId },
    data: { status: "PROCESSING", errorMessage: null },
  });

  const kpis = await prisma.kpiDefinition.findMany({
    where: { userId, active: true },
    orderBy: { sortOrder: "asc" },
  });

  // Images are re-read from storage rather than trusted from the request, and
  // are already normalised to PNG at upload time.
  const storage = getStorage();
  const images = await Promise.all(
    snapshot.images.map(async (image) => ({
      label: image.label,
      mediaType: "image/png" as const,
      base64: (await storage.get(image.storageKey)).toString("base64"),
    })),
  );

  const budget = await checkBudget({
    userId,
    timezone,
    feature: "SCREENSHOT_EXTRACTION",
    routingReason: options.forceEscalation ? "RETRY_ESCALATION" : "ROUTINE",
    estimatedInputTokens: 900,
    estimatedOutputTokens: 700,
    imageCount: images.length,
  });

  if (budget.decision === "BLOCK") {
    await prisma.snapshot.update({
      where: { id: snapshotId },
      data: { status: "FAILED", errorMessage: budget.message },
    });
    return failure(snapshotId, budget.model, 0, budget.message ?? "AI budget exceeded.", budget.message);
  }

  const provider = getAiProvider();
  const maxAttempts = Math.min(config.AI_MAX_EXTRACTION_ATTEMPTS, LADDER.length);
  const startRung = options.forceEscalation ? LADDER.length - 1 : 0;

  let success: AiResult<ExtractionResult> | null = null;
  let lastError = "";
  let attemptNumber = 0;
  let totalCost = 0;

  for (let rung = startRung; rung < Math.max(startRung + 1, maxAttempts); rung++) {
    const step = LADDER[Math.min(rung, LADDER.length - 1)];
    if (!step) break;
    attemptNumber += 1;

    const model = step.escalate || options.forceEscalation ? settings.models.escalation : budget.model;
    const request: ExtractKpisRequest = {
      images,
      knownKpis: kpis.map((k) => ({ key: k.key, displayName: k.displayName, aliases: k.aliases })),
      today: todayInTz(timezone),
      timezone,
      model,
      strategy: step.strategy === "STANDARD" ? "STANDARD" : "EXPLICIT",
    };

    const startedAt = Date.now();
    try {
      const result = await provider.extractKpis(request);
      totalCost += result.meta.estimatedCostUsd;

      await Promise.all([
        prisma.extractionAttempt.create({
          data: {
            snapshotId,
            attemptNumber,
            strategy: step.escalate ? "ESCALATED" : step.strategy,
            model,
            promptVersion: result.meta.promptVersion,
            success: true,
            rawResponse: result.raw as object,
            inputTokens: result.meta.usage.inputTokens,
            outputTokens: result.meta.usage.outputTokens,
            costUsd: result.meta.estimatedCostUsd,
            latencyMs: result.meta.latencyMs,
          },
        }),
        recordAiRequest({ userId, feature: "SCREENSHOT_EXTRACTION", meta: result.meta, snapshotId }),
      ]);

      // An empty result is a failure worth retrying, not a valid extraction.
      if (result.data.metrics.length === 0 && rung < maxAttempts - 1) {
        lastError = "No KPI values were found in these screenshots.";
        continue;
      }

      success = result;
      break;
    } catch (error) {
      lastError = describeAiError(error);
      await Promise.all([
        prisma.extractionAttempt.create({
          data: {
            snapshotId,
            attemptNumber,
            strategy: step.escalate ? "ESCALATED" : step.strategy,
            model,
            promptVersion: "n/a",
            success: false,
            errorMessage: lastError.slice(0, 1000),
            latencyMs: Date.now() - startedAt,
          },
        }),
        recordAiFailure({
          userId,
          feature: "SCREENSHOT_EXTRACTION",
          model,
          errorMessage: lastError,
          latencyMs: Date.now() - startedAt,
          snapshotId,
        }),
        logger.warn({
          userId,
          category: "extraction",
          message: `Attempt ${attemptNumber} failed: ${lastError}`,
          meta: { snapshotId, model, strategy: step.strategy },
        }),
      ]);
    }
  }

  if (!success) {
    const message =
      lastError ||
      "Extraction did not produce usable data. You can enter the values manually from the snapshot page.";
    await prisma.snapshot.update({
      where: { id: snapshotId },
      data: { status: "FAILED", errorMessage: message.slice(0, 1000) },
    });
    return failure(snapshotId, budget.model, attemptNumber, message, budget.message, totalCost);
  }

  return persistExtraction({
    userId,
    snapshotId,
    timezone,
    result: success,
    kpis,
    confidenceThreshold: settings.confidenceThreshold,
    attempts: attemptNumber,
    costUsd: totalCost,
    budgetWarning: budget.message,
    imageLabelToId: new Map(snapshot.images.map((i) => [i.label, i.id])),
    capturedAt: snapshot.capturedAt,
  });
}

interface PersistArgs {
  userId: string;
  snapshotId: string;
  timezone: string;
  result: AiResult<ExtractionResult>;
  kpis: { id: string; key: string; displayName: string; aliases: string[]; unitType: string }[];
  confidenceThreshold: number;
  attempts: number;
  costUsd: number;
  budgetWarning: string | null;
  imageLabelToId: Map<string, string>;
  capturedAt: Date;
}

async function persistExtraction(args: PersistArgs): Promise<ProcessResult> {
  const { result, kpis, confidenceThreshold } = args;
  const extraction = result.data;

  // Reconcile before touching the database: two screenshots disagreeing about
  // the same KPI must never both land as accepted values.
  const candidates: ExtractedMetric[] = extraction.metrics.map((m) => {
    const matched = matchKpi({ key: m.key, label: m.display_name }, kpis);
    return {
      key: matched?.key ?? null,
      label: m.display_name,
      value: m.value,
      unit: m.unit,
      confidence: m.confidence,
      sourceImage: m.source_image,
      periodStart: m.period_start,
      periodEnd: m.period_end,
    };
  });

  const { agreed, conflicts } = reconcileMetrics(candidates);
  const conflictKeys = new Set(conflicts.map((c) => c.groupKey));

  const periodStart = extraction.reporting_period.start;
  const periodEnd = extraction.reporting_period.end;

  let autoAccepted = 0;
  let reviewCount = 0;
  let unmappedCount = 0;

  const rows: {
    kpiId: string | null;
    rawLabel: string;
    rawValue: string;
    value: number;
    confidence: number;
    sourceImageId: string | null;
    status: ObservationStatus;
    conflictKey: string | null;
    notes: string | null;
    unit: string | null;
  }[] = [];

  const push = (metric: ExtractedMetric, forcedStatus?: ObservationStatus) => {
    const matched = matchKpi({ key: metric.key, label: metric.label }, kpis);
    const unitType = (matched
      ? kpis.find((k) => k.id === matched.id)?.unitType ?? "COUNT"
      : "COUNT") as "COUNT" | "CURRENCY" | "PERCENT" | "RATIO";

    const validation = validateValue(metric.value, unitType);
    const original = extraction.metrics.find(
      (m) => m.display_name === metric.label && m.source_image === metric.sourceImage,
    );

    let status: ObservationStatus;
    if (forcedStatus) status = forcedStatus;
    else if (!matched) status = "UNMAPPED";
    else if (needsReview(metric.confidence, confidenceThreshold, validation)) status = "PENDING";
    else status = "ACCEPTED";

    if (status === "ACCEPTED") autoAccepted += 1;
    else if (status === "UNMAPPED") unmappedCount += 1;
    else reviewCount += 1;

    const notes = [validation.message, original?.notes].filter(Boolean).join(" ") || null;

    rows.push({
      kpiId: matched?.id ?? null,
      rawLabel: metric.label,
      rawValue: original?.raw_text ?? String(metric.value),
      value: metric.value,
      confidence: metric.confidence,
      sourceImageId: args.imageLabelToId.get(metric.sourceImage) ?? null,
      status,
      conflictKey: forcedStatus === "CONFLICT" ? (metric.key ?? metric.label) : null,
      notes,
      unit: metric.unit,
    });
  };

  for (const metric of agreed) {
    if (conflictKeys.has(metric.key ?? `label:${metric.label.trim().toLowerCase()}`)) continue;
    push(metric);
  }
  for (const conflict of conflicts) {
    for (const reading of conflict.readings) {
      push(
        {
          key: conflict.groupKey.startsWith("label:") ? null : conflict.groupKey,
          label: conflict.label,
          value: reading.value,
          unit: null,
          confidence: reading.confidence,
          sourceImage: reading.sourceImage,
          periodStart: reading.periodStart,
          periodEnd: reading.periodEnd,
        },
        "CONFLICT",
      );
    }
  }

  const needsHuman = reviewCount > 0 || unmappedCount > 0 || conflicts.length > 0;
  const status = needsHuman ? "NEEDS_REVIEW" : "CONFIRMED";
  const averageConfidence =
    rows.length > 0 ? rows.reduce((sum, r) => sum + r.confidence, 0) / rows.length : 0;

  await prisma.$transaction(async (tx) => {
    // Re-processing replaces the previous extraction but never the snapshot or
    // its images, so history and the audit trail survive.
    await tx.metricObservation.deleteMany({ where: { snapshotId: args.snapshotId } });

    if (rows.length > 0) {
      await tx.metricObservation.createMany({
        data: rows.map((row) => ({
          userId: args.userId,
          snapshotId: args.snapshotId,
          kpiId: row.kpiId,
          rawLabel: row.rawLabel,
          rawValue: row.rawValue,
          value: row.value,
          aiValue: row.value,
          unit: row.unit,
          confidence: row.confidence,
          sourceImageId: row.sourceImageId,
          status: row.status,
          conflictKey: row.conflictKey,
          notes: row.notes,
          effectiveAt: args.capturedAt,
          periodStart: periodStart ? dateKeyToUtc(periodStart) : null,
          periodEnd: periodEnd ? dateKeyToUtc(periodEnd) : null,
        })),
      });
    }

    await tx.snapshot.update({
      where: { id: args.snapshotId },
      data: {
        status,
        extractionModel: result.meta.model,
        extractionPromptVersion: result.meta.promptVersion,
        overallConfidence: Math.round(averageConfidence * 10000) / 10000,
        rawExtraction: result.raw as object,
        reportingPeriodStart: periodStart ? dateKeyToUtc(periodStart) : null,
        reportingPeriodEnd: periodEnd ? dateKeyToUtc(periodEnd) : null,
        periodDetected: Boolean(periodStart && periodEnd),
        confirmedAt: status === "CONFIRMED" ? new Date() : null,
        errorMessage: null,
      },
    });

    await tx.snapshotImage.updateMany({ where: { snapshotId: args.snapshotId }, data: { processed: true } });
  });

  const message = needsHuman
    ? `Extracted ${rows.length} value${rows.length === 1 ? "" : "s"}. ${
        reviewCount + unmappedCount + conflicts.length
      } need${reviewCount + unmappedCount + conflicts.length === 1 ? "s" : ""} your review.`
    : `Snapshot processed — ${rows.length} value${rows.length === 1 ? "" : "s"} confirmed.`;

  await logger.info({
    userId: args.userId,
    category: "extraction",
    message,
    meta: {
      snapshotId: args.snapshotId,
      model: result.meta.model,
      costUsd: args.costUsd,
      autoAccepted,
      reviewCount,
      conflicts: conflicts.length,
    },
  });

  return {
    snapshotId: args.snapshotId,
    status,
    metricsExtracted: rows.length,
    autoAccepted,
    needsReviewCount: reviewCount,
    conflictCount: conflicts.length,
    unmappedCount,
    model: result.meta.model,
    attempts: args.attempts,
    costUsd: Math.round(args.costUsd * 1_000_000) / 1_000_000,
    message,
    budgetWarning: args.budgetWarning,
  };
}

function failure(
  snapshotId: string,
  model: string,
  attempts: number,
  message: string,
  budgetWarning: string | null = null,
  costUsd = 0,
): ProcessResult {
  return {
    snapshotId,
    status: "FAILED",
    metricsExtracted: 0,
    autoAccepted: 0,
    needsReviewCount: 0,
    conflictCount: 0,
    unmappedCount: 0,
    model,
    attempts,
    costUsd,
    message,
    budgetWarning,
  };
}
