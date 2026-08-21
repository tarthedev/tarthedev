import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { normalizeKey } from "@/lib/kpi/normalize";
import type { ObservationStatus } from "@/generated/prisma";

export type ReviewAction = "ACCEPT" | "REJECT" | "CORRECT";

export interface ReviewDecision {
  observationId: string;
  action: ReviewAction;
  /** Required for CORRECT. */
  value?: number;
  /** Assigns an unmapped reading to a KPI, existing or newly created. */
  kpiId?: string;
}

export interface ReviewOutcome {
  applied: number;
  remainingPending: number;
  snapshotStatus: "NEEDS_REVIEW" | "CONFIRMED";
}

/**
 * Applies human decisions to extracted values.
 *
 * Corrections never destroy the model's reading: `aiValue` keeps what the model
 * said, `value` becomes what the human said, and `isCorrected` marks the row.
 * That is what makes extraction quality measurable over time.
 */
export async function applyDecisions(
  userId: string,
  snapshotId: string,
  decisions: ReviewDecision[],
): Promise<ReviewOutcome> {
  const snapshot = await prisma.snapshot.findFirst({
    where: { id: snapshotId, userId },
    select: { id: true },
  });
  if (!snapshot) throw new Error("Snapshot not found.");

  const observations = await prisma.metricObservation.findMany({
    where: { snapshotId, userId, id: { in: decisions.map((d) => d.observationId) } },
    select: { id: true, aiValue: true, value: true, kpiId: true },
  });
  const byId = new Map(observations.map((o) => [o.id, o]));

  let applied = 0;

  await prisma.$transaction(async (tx) => {
    for (const decision of decisions) {
      const existing = byId.get(decision.observationId);
      if (!existing) continue;

      if (decision.action === "REJECT") {
        await tx.metricObservation.update({
          where: { id: decision.observationId },
          data: { status: "REJECTED" },
        });
        applied += 1;
        continue;
      }

      const kpiId = decision.kpiId ?? existing.kpiId;
      if (!kpiId) {
        // Accepting a reading with no KPI would create an orphan the dashboard
        // can never show, so it stays unmapped until a KPI is chosen.
        continue;
      }

      const corrected = decision.action === "CORRECT" && typeof decision.value === "number";
      if (corrected && !Number.isFinite(decision.value as number)) continue;

      const status: ObservationStatus = "ACCEPTED";
      await tx.metricObservation.update({
        where: { id: decision.observationId },
        data: {
          status,
          kpiId,
          ...(corrected
            ? {
                value: decision.value,
                correctedValue: decision.value,
                correctedAt: new Date(),
                isCorrected: true,
                // aiValue is deliberately left untouched.
              }
            : {}),
        },
      });
      applied += 1;
    }

    // Accepting one reading from a conflict group resolves the others.
    await resolveConflicts(tx, snapshotId, userId);
  });

  const remainingPending = await prisma.metricObservation.count({
    where: { snapshotId, userId, status: { in: ["PENDING", "CONFLICT", "UNMAPPED"] } },
  });

  const snapshotStatus = remainingPending === 0 ? "CONFIRMED" : "NEEDS_REVIEW";
  await prisma.snapshot.update({
    where: { id: snapshotId },
    data: {
      status: snapshotStatus,
      confirmedAt: snapshotStatus === "CONFIRMED" ? new Date() : null,
    },
  });

  await logger.info({
    userId,
    category: "review",
    message: `Applied ${applied} review decision${applied === 1 ? "" : "s"}.`,
    meta: { snapshotId, remainingPending, snapshotStatus },
  });

  return { applied, remainingPending, snapshotStatus };
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Marks the losing readings in a conflict group as rejected once one is accepted. */
async function resolveConflicts(tx: Tx, snapshotId: string, userId: string): Promise<void> {
  const accepted = await tx.metricObservation.findMany({
    where: { snapshotId, userId, status: "ACCEPTED", kpiId: { not: null } },
    select: { id: true, kpiId: true },
  });
  const acceptedKpiIds = accepted.map((a) => a.kpiId).filter((id): id is string => id !== null);
  if (acceptedKpiIds.length === 0) return;

  await tx.metricObservation.updateMany({
    where: {
      snapshotId,
      userId,
      status: "CONFLICT",
      kpiId: { in: acceptedKpiIds },
      id: { notIn: accepted.map((a) => a.id) },
    },
    data: { status: "REJECTED" },
  });
}

/**
 * Confirms a snapshot outright, accepting every still-pending reading.
 * Conflicts are excluded — those genuinely need a choice.
 */
export async function acceptAllPending(userId: string, snapshotId: string): Promise<ReviewOutcome> {
  const pending = await prisma.metricObservation.findMany({
    where: { snapshotId, userId, status: "PENDING", kpiId: { not: null } },
    select: { id: true },
  });

  return applyDecisions(
    userId,
    snapshotId,
    pending.map((p) => ({ observationId: p.id, action: "ACCEPT" as const })),
  );
}

/**
 * Turns an unmapped reading into a real KPI (spec: "New KPI detected: XYZ").
 * The reading is attached to the new definition in the same transaction.
 */
export async function createKpiFromObservation(
  userId: string,
  observationId: string,
  overrides: { key?: string; displayName?: string; category?: string; weight?: number } = {},
): Promise<{ kpiId: string; key: string }> {
  const observation = await prisma.metricObservation.findFirst({
    where: { id: observationId, userId },
    select: { id: true, rawLabel: true, snapshotId: true },
  });
  if (!observation) throw new Error("Observation not found.");

  const displayName = overrides.displayName?.trim() || observation.rawLabel;
  const key = normalizeKey(overrides.key?.trim() || displayName);
  if (!key) throw new Error("Could not derive a KPI key from that label.");

  const existing = await prisma.kpiDefinition.findUnique({
    where: { userId_key: { userId, key } },
    select: { id: true, key: true },
  });
  if (existing) {
    await prisma.metricObservation.update({
      where: { id: observationId },
      data: { kpiId: existing.id, status: "PENDING" },
    });
    return { kpiId: existing.id, key: existing.key };
  }

  const maxSort = await prisma.kpiDefinition.aggregate({
    where: { userId },
    _max: { sortOrder: true },
  });

  const created = await prisma.kpiDefinition.create({
    data: {
      userId,
      key,
      displayName,
      category: overrides.category ?? null,
      weight: overrides.weight ?? 1,
      sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
      aliases: observation.rawLabel !== displayName ? [observation.rawLabel] : [],
    },
    select: { id: true, key: true },
  });

  await prisma.metricObservation.update({
    where: { id: observationId },
    data: { kpiId: created.id, status: "PENDING" },
  });

  await logger.info({
    userId,
    category: "kpi",
    message: `Created KPI "${displayName}" from an unmapped reading.`,
    meta: { key, observationId },
  });

  return { kpiId: created.id, key: created.key };
}

/** Edits an already-confirmed value, preserving the original AI reading. */
export async function correctObservation(
  userId: string,
  observationId: string,
  value: number,
): Promise<void> {
  if (!Number.isFinite(value)) throw new Error("Value must be a number.");

  const observation = await prisma.metricObservation.findFirst({
    where: { id: observationId, userId },
    select: { id: true, snapshotId: true },
  });
  if (!observation) throw new Error("Observation not found.");

  await prisma.metricObservation.update({
    where: { id: observationId },
    data: {
      value,
      correctedValue: value,
      correctedAt: new Date(),
      isCorrected: true,
      status: "ACCEPTED",
    },
  });
}
