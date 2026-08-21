import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getSettings } from "@/lib/settings";
import { describeAiError } from "@/lib/ai/anthropic";
import { BudgetExceededError, checkBudget } from "@/lib/ai/budget";
import { buildPerformanceContext, fingerprintContext, type HistoryPoint } from "@/lib/ai/context";
import { getAiProvider } from "@/lib/ai/provider";
import type { CoachBrief } from "@/lib/ai/schemas";
import { recordAiFailure, recordAiRequest } from "@/lib/ai/usage";
import { buildDashboard, type DashboardData } from "@/lib/kpi/dashboard";
import { previousPeriod } from "@/lib/kpi/period";

export interface CoachResult {
  brief: CoachBrief;
  model: string;
  generatedAt: Date;
  /** True when the brief came from cache and cost nothing. */
  cached: boolean;
  costUsd: number;
  budgetWarning: string | null;
}

/**
 * The coach brief is cached against a fingerprint of the numbers it was written
 * from. Opening the dashboard ten times in an evening costs one model call, not
 * ten — the brief regenerates only when a snapshot is confirmed, a goal changes,
 * or a refresh is explicitly requested.
 */
export async function getCoachBrief(
  userId: string,
  timezone: string,
  options: { force?: boolean; dashboard?: DashboardData } = {},
): Promise<CoachResult> {
  const data = options.dashboard ?? (await buildDashboard(userId, timezone));
  const cacheKey = `${data.period.start}:${data.period.end}`;
  const fingerprint = fingerprintContext(data);

  const cached = await prisma.coachBrief.findUnique({
    where: { userId_kind_cacheKey: { userId, kind: "DAILY_BRIEF", cacheKey } },
  });

  if (!options.force && cached && cached.dataFingerprint === fingerprint) {
    return {
      brief: cached.content as CoachBrief,
      model: cached.model,
      generatedAt: cached.generatedAt,
      cached: true,
      costUsd: 0,
      budgetWarning: null,
    };
  }

  const context = buildPerformanceContext(data, { history: await loadHistory(userId, timezone, data) });

  const budget = await checkBudget({
    userId,
    timezone,
    feature: "COACH_BRIEF",
    estimatedInputTokens: Math.ceil(context.length / 3.5) + 400,
    estimatedOutputTokens: 500,
  });

  if (budget.decision === "BLOCK") {
    // A cached brief, even a slightly stale one, beats no coaching at all.
    if (cached) {
      return {
        brief: cached.content as CoachBrief,
        model: cached.model,
        generatedAt: cached.generatedAt,
        cached: true,
        costUsd: 0,
        budgetWarning: budget.message,
      };
    }
    throw new BudgetExceededError(budget.message ?? "AI budget exceeded.", budget);
  }

  const settings = await getSettings(userId);
  const model = budget.decision === "ALLOW_DOWNGRADED" ? budget.model : settings.models.coach;

  try {
    const result = await getAiProvider().generateCoach({ context, model });
    await recordAiRequest({ userId, feature: "COACH_BRIEF", meta: result.meta });

    const saved = await prisma.coachBrief.upsert({
      where: { userId_kind_cacheKey: { userId, kind: "DAILY_BRIEF", cacheKey } },
      create: {
        userId,
        kind: "DAILY_BRIEF",
        cacheKey,
        model: result.meta.model,
        content: result.data,
        dataFingerprint: fingerprint,
      },
      update: {
        model: result.meta.model,
        content: result.data,
        dataFingerprint: fingerprint,
        generatedAt: new Date(),
      },
    });

    return {
      brief: result.data,
      model: result.meta.model,
      generatedAt: saved.generatedAt,
      cached: false,
      costUsd: result.meta.estimatedCostUsd,
      budgetWarning: budget.message,
    };
  } catch (error) {
    const message = describeAiError(error);
    await Promise.all([
      recordAiFailure({ userId, feature: "COACH_BRIEF", model, errorMessage: message }),
      logger.error({ userId, category: "coach", message, meta: { model } }),
    ]);
    throw new Error(message);
  }
}

/** Invalidates cached briefs — called whenever confirmed data changes. */
export async function invalidateCoachCache(userId: string): Promise<void> {
  await prisma.coachBrief.updateMany({
    where: { userId, kind: "DAILY_BRIEF" },
    data: { dataFingerprint: "stale" },
  });
}

export interface ChatResult {
  answer: string;
  model: string;
  costUsd: number;
  budgetWarning: string | null;
}

export async function askQuestion(
  userId: string,
  timezone: string,
  question: string,
): Promise<ChatResult> {
  const data = await buildDashboard(userId, timezone);
  const context = buildPerformanceContext(data, {
    history: await loadHistory(userId, timezone, data),
    includeDailyProduction: true,
  });

  const budget = await checkBudget({
    userId,
    timezone,
    feature: "CHAT",
    estimatedInputTokens: Math.ceil((context.length + question.length) / 3.5) + 300,
    estimatedOutputTokens: 300,
  });
  if (budget.decision === "BLOCK") {
    throw new BudgetExceededError(budget.message ?? "AI budget exceeded.", budget);
  }

  const settings = await getSettings(userId);
  const model = budget.decision === "ALLOW_DOWNGRADED" ? budget.model : settings.models.chat;

  // Only the last few turns are replayed — the whole database is never sent and
  // neither is the whole conversation.
  const recent = await prisma.chatMessage.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 6,
    select: { role: true, content: true },
  });
  const history = recent
    .reverse()
    .map((m) => ({ role: m.role === "USER" ? ("user" as const) : ("assistant" as const), content: m.content }));

  try {
    const result = await getAiProvider().answerQuestion({ context, question, history, model });
    await Promise.all([
      recordAiRequest({ userId, feature: "CHAT", meta: result.meta }),
      prisma.chatMessage.createMany({
        data: [
          { userId, role: "USER", content: question },
          {
            userId,
            role: "ASSISTANT",
            content: result.data,
            model: result.meta.model,
            contextUsed: context.slice(0, 8000),
          },
        ],
      }),
    ]);

    return {
      answer: result.data,
      model: result.meta.model,
      costUsd: result.meta.estimatedCostUsd,
      budgetWarning: budget.message,
    };
  } catch (error) {
    const message = describeAiError(error);
    await recordAiFailure({ userId, feature: "CHAT", model, errorMessage: message });
    throw new Error(message);
  }
}

export async function runDeepAnalysis(
  userId: string,
  timezone: string,
  focus?: string,
): Promise<{ analysis: string; model: string; costUsd: number }> {
  const data = await buildDashboard(userId, timezone);
  const context = buildPerformanceContext(data, {
    history: await loadHistory(userId, timezone, data, 6),
    includeDailyProduction: true,
  });

  const budget = await checkBudget({
    userId,
    timezone,
    feature: "DEEP_ANALYSIS",
    routingReason: "USER_REQUESTED_DEEP",
    estimatedInputTokens: Math.ceil(context.length / 3.5) + 500,
    estimatedOutputTokens: 1800,
  });
  if (budget.decision === "BLOCK") {
    throw new BudgetExceededError(budget.message ?? "AI budget exceeded.", budget);
  }

  const settings = await getSettings(userId);
  const model = settings.models.deepAnalysis;

  try {
    const result = await getAiProvider().deepAnalyze({ context, focus, model });
    await recordAiRequest({ userId, feature: "DEEP_ANALYSIS", meta: result.meta });
    return { analysis: result.data, model: result.meta.model, costUsd: result.meta.estimatedCostUsd };
  } catch (error) {
    const message = describeAiError(error);
    await recordAiFailure({ userId, feature: "DEEP_ANALYSIS", model, errorMessage: message });
    throw new Error(message);
  }
}

/**
 * Attainment for the preceding periods. Deliberately summarised to a handful of
 * numbers per period — sending raw history would blow the token budget for no
 * additional insight.
 */
async function loadHistory(
  userId: string,
  timezone: string,
  current: DashboardData,
  count = 3,
): Promise<HistoryPoint[]> {
  const points: HistoryPoint[] = [];
  let period = current.period;

  for (let i = 0; i < count; i++) {
    period = previousPeriod(period, { weekStartsOn: current.settings.weekStartsOn });
    const past = await buildDashboard(userId, timezone, {
      range: { start: period.start, end: period.end },
    });

    const kpis = past.rows
      .filter((r) => r.observationCount > 0 || r.targetValue > 0)
      .map((r) => ({
        key: r.key,
        displayName: r.displayName,
        value: r.current,
        target: r.targetValue,
        attainmentPct: r.pace.attainmentPct,
      }));

    // Stop as soon as history runs out; empty periods add tokens and no signal.
    if (kpis.every((k) => k.value === 0)) break;
    points.push({ periodLabel: period.label, overallScore: past.overall.score, kpis });
  }

  return points;
}
