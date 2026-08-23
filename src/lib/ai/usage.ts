import { prisma } from "@/lib/db";
import type { AiFeature } from "@/lib/ai/types";
import type { AiCallMeta } from "@/lib/ai/types";
import {
  startOfMonth,
  startOfWeek,
  todayInTz,
  zonedDayStartUtc,
} from "@/lib/kpi/dates";

export interface RecordUsageArgs {
  userId: string;
  feature: AiFeature;
  meta: AiCallMeta;
  success?: boolean;
  errorMessage?: string | null;
  snapshotId?: string | null;
}

/** Appends one row to the immutable AI cost ledger. */
export async function recordAiRequest(args: RecordUsageArgs): Promise<void> {
  const { meta } = args;
  await prisma.aiRequest.create({
    data: {
      userId: args.userId,
      feature: args.feature,
      provider: meta.provider,
      model: meta.model,
      promptVersion: meta.promptVersion,
      inputTokens: meta.usage.inputTokens,
      outputTokens: meta.usage.outputTokens,
      cacheReadTokens: meta.usage.cacheReadTokens ?? 0,
      cacheCreationTokens: meta.usage.cacheCreationTokens ?? 0,
      estimatedCostUsd: meta.estimatedCostUsd,
      latencyMs: meta.latencyMs,
      success: args.success ?? true,
      errorMessage: args.errorMessage ?? null,
      snapshotId: args.snapshotId ?? null,
    },
  });
}

/** Records a call that failed before or during the model round-trip. */
export async function recordAiFailure(args: {
  userId: string;
  feature: AiFeature;
  model: string;
  errorMessage: string;
  latencyMs?: number;
  snapshotId?: string | null;
}): Promise<void> {
  await prisma.aiRequest.create({
    data: {
      userId: args.userId,
      feature: args.feature,
      model: args.model,
      estimatedCostUsd: 0,
      latencyMs: args.latencyMs ?? 0,
      success: false,
      errorMessage: args.errorMessage,
      snapshotId: args.snapshotId ?? null,
    },
  });
}

export interface UsageBucket {
  costUsd: number;
  requests: number;
  inputTokens: number;
  outputTokens: number;
}

export interface UsageBreakdownRow {
  label: string;
  costUsd: number;
  requests: number;
}

export interface UsageSummary {
  today: UsageBucket;
  week: UsageBucket;
  month: UsageBucket;
  allTime: UsageBucket;
  byModel: UsageBreakdownRow[];
  byFeature: UsageBreakdownRow[];
  monthlyBudgetUsd: number;
  budgetUsedPct: number;
  /** Straight-line month-end spend at the current daily rate. */
  projectedMonthCostUsd: number;
  cacheSavingsTokens: number;
}

const EMPTY: UsageBucket = { costUsd: 0, requests: 0, inputTokens: 0, outputTokens: 0 };

async function bucket(userId: string, since: Date | null): Promise<UsageBucket> {
  const aggregate = await prisma.aiRequest.aggregate({
    where: { userId, ...(since ? { createdAt: { gte: since } } : {}) },
    _sum: { estimatedCostUsd: true, inputTokens: true, outputTokens: true },
    _count: { _all: true },
  });
  return {
    costUsd: round6(aggregate._sum.estimatedCostUsd ?? 0),
    requests: aggregate._count._all,
    inputTokens: aggregate._sum.inputTokens ?? 0,
    outputTokens: aggregate._sum.outputTokens ?? 0,
  };
}

const round6 = (n: number): number => Math.round(n * 1_000_000) / 1_000_000;

export async function getUsageSummary(
  userId: string,
  timezone: string,
  monthlyBudgetUsd: number,
): Promise<UsageSummary> {
  const today = todayInTz(timezone);
  const dayStart = zonedDayStartUtc(today, timezone);
  const weekStart = zonedDayStartUtc(startOfWeek(today), timezone);
  const monthStartKey = startOfMonth(today);
  const monthStart = zonedDayStartUtc(monthStartKey, timezone);

  const [todayBucket, weekBucket, monthBucket, allTime, byModelRaw, byFeatureRaw, cacheAgg] =
    await Promise.all([
      bucket(userId, dayStart),
      bucket(userId, weekStart),
      bucket(userId, monthStart),
      bucket(userId, null),
      prisma.aiRequest.groupBy({
        by: ["model"],
        where: { userId, createdAt: { gte: monthStart } },
        _sum: { estimatedCostUsd: true },
        _count: { _all: true },
      }),
      prisma.aiRequest.groupBy({
        by: ["feature"],
        where: { userId, createdAt: { gte: monthStart } },
        _sum: { estimatedCostUsd: true },
        _count: { _all: true },
      }),
      prisma.aiRequest.aggregate({
        where: { userId, createdAt: { gte: monthStart } },
        _sum: { cacheReadTokens: true },
      }),
    ]);

  const dayOfMonth = Number(today.slice(8, 10));
  const daysInMonth = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).getUTCDate();
  const projected =
    dayOfMonth > 0 ? round6((monthBucket.costUsd / dayOfMonth) * daysInMonth) : monthBucket.costUsd;

  return {
    today: todayBucket ?? EMPTY,
    week: weekBucket ?? EMPTY,
    month: monthBucket ?? EMPTY,
    allTime: allTime ?? EMPTY,
    byModel: byModelRaw
      .map((r) => ({
        label: r.model,
        costUsd: round6(r._sum.estimatedCostUsd ?? 0),
        requests: r._count._all,
      }))
      .sort((a, b) => b.costUsd - a.costUsd),
    byFeature: byFeatureRaw
      .map((r) => ({
        label: r.feature,
        costUsd: round6(r._sum.estimatedCostUsd ?? 0),
        requests: r._count._all,
      }))
      .sort((a, b) => b.costUsd - a.costUsd),
    monthlyBudgetUsd,
    budgetUsedPct:
      monthlyBudgetUsd > 0 ? Math.round((monthBucket.costUsd / monthlyBudgetUsd) * 1000) / 10 : 0,
    projectedMonthCostUsd: projected,
    cacheSavingsTokens: cacheAgg._sum.cacheReadTokens ?? 0,
  };
}

/** Month-to-date spend only — the hot path for the budget guardrail. */
export async function getMonthToDateCost(userId: string, timezone: string): Promise<number> {
  const monthStart = zonedDayStartUtc(startOfMonth(todayInTz(timezone)), timezone);
  const aggregate = await prisma.aiRequest.aggregate({
    where: { userId, createdAt: { gte: monthStart } },
    _sum: { estimatedCostUsd: true },
  });
  return round6(aggregate._sum.estimatedCostUsd ?? 0);
}
