import { prisma } from "@/lib/db";
import { fail, searchParams, withAuth } from "@/lib/http/api";
import { utcToDateKey } from "@/lib/kpi/dates";

type Dataset = "observations" | "snapshots" | "goals" | "usage";
const DATASETS: ReadonlySet<string> = new Set<Dataset>(["observations", "snapshots", "goals", "usage"]);

/** RFC 4180 quoting — a KPI label containing a comma must not break the file. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = value instanceof Date ? value.toISOString() : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0] as Record<string, unknown>);
  const lines = [headers.join(",")];
  for (const row of rows) lines.push(headers.map((h) => csvCell(row[h])).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

/**
 * GET /api/export?dataset=observations&format=csv
 *
 * Victra does not export, so this application does. Everything stored here is
 * the user's own data and leaves in a format a spreadsheet can open.
 */
export const GET = withAuth(async ({ user, request }) => {
  const params = searchParams(request);
  const dataset = params.get("dataset") ?? "observations";
  const format = params.get("format") === "json" ? "json" : "csv";

  if (!DATASETS.has(dataset)) {
    return fail(400, {
      error: `Unknown dataset "${dataset}".`,
      detail: `Choose one of: ${[...DATASETS].join(", ")}.`,
    });
  }

  const rows = await loadDataset(user.id, dataset as Dataset);
  const filename = `kpi-${dataset}-${new Date().toISOString().slice(0, 10)}.${format}`;

  const body = format === "json" ? JSON.stringify(rows, null, 2) : toCsv(rows);
  return new Response(body, {
    headers: {
      "Content-Type": format === "json" ? "application/json; charset=utf-8" : "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
});

async function loadDataset(userId: string, dataset: Dataset): Promise<Record<string, unknown>[]> {
  switch (dataset) {
    case "observations": {
      const rows = await prisma.metricObservation.findMany({
        where: { userId },
        orderBy: { effectiveAt: "asc" },
        include: { kpi: { select: { key: true, displayName: true } }, snapshot: { select: { capturedAt: true } } },
      });
      return rows.map((r) => ({
        capturedAt: r.snapshot.capturedAt.toISOString(),
        kpiKey: r.kpi?.key ?? "",
        kpiName: r.kpi?.displayName ?? r.rawLabel,
        value: r.value,
        aiValue: r.aiValue,
        correctedValue: r.correctedValue,
        wasCorrected: r.isCorrected,
        confidence: r.confidence,
        status: r.status,
        rawLabel: r.rawLabel,
        rawValue: r.rawValue,
        snapshotId: r.snapshotId,
      }));
    }
    case "snapshots": {
      const rows = await prisma.snapshot.findMany({
        where: { userId },
        orderBy: { capturedAt: "asc" },
        include: { _count: { select: { observations: true, images: true } } },
      });
      return rows.map((r) => ({
        id: r.id,
        capturedAt: r.capturedAt.toISOString(),
        status: r.status,
        images: r._count.images,
        readings: r._count.observations,
        overallConfidence: r.overallConfidence,
        model: r.extractionModel,
        promptVersion: r.extractionPromptVersion,
        reportingPeriodStart: r.reportingPeriodStart ? utcToDateKey(r.reportingPeriodStart) : "",
        reportingPeriodEnd: r.reportingPeriodEnd ? utcToDateKey(r.reportingPeriodEnd) : "",
      }));
    }
    case "goals": {
      const rows = await prisma.goal.findMany({
        where: { userId },
        orderBy: { periodStart: "asc" },
        include: { kpi: { select: { key: true, displayName: true } } },
      });
      return rows.map((r) => ({
        kpiKey: r.kpi.key,
        kpiName: r.kpi.displayName,
        periodType: r.periodType,
        periodStart: utcToDateKey(r.periodStart),
        periodEnd: utcToDateKey(r.periodEnd),
        minimum: r.minimumValue,
        target: r.targetValue,
        stretch: r.stretchValue,
        scope: r.scope,
        priority: r.priority,
        active: r.active,
      }));
    }
    case "usage": {
      const rows = await prisma.aiRequest.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
      return rows.map((r) => ({
        createdAt: r.createdAt.toISOString(),
        feature: r.feature,
        provider: r.provider,
        model: r.model,
        promptVersion: r.promptVersion,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        cacheReadTokens: r.cacheReadTokens,
        cacheCreationTokens: r.cacheCreationTokens,
        estimatedCostUsd: r.estimatedCostUsd,
        latencyMs: r.latencyMs,
        success: r.success,
      }));
    }
  }
}
