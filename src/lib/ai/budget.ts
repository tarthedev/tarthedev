import { env } from "@/lib/env";
import { estimateRequestCost, formatUsd } from "@/lib/ai/models";
import { getMonthToDateCost } from "@/lib/ai/usage";
import type { AiFeature } from "@/lib/ai/types";
import { routeModel, type RoutingReason } from "@/lib/ai/provider";

/**
 * Extraction is the core workflow — blocking it breaks the product — so it is
 * allowed to run past the soft budget up to a hard ceiling. Everything else is
 * a convenience and stops at the soft budget.
 */
const ESSENTIAL_FEATURES: ReadonlySet<AiFeature> = new Set<AiFeature>(["SCREENSHOT_EXTRACTION"]);

/** Absolute ceiling as a multiple of the configured budget. Nothing runs past it. */
const HARD_CAP_MULTIPLIER = 1.25;

/** Above this share of the budget, routine work is pushed to the cheaper model. */
const DOWNGRADE_THRESHOLD = 0.8;

export type BudgetDecision = "ALLOW" | "ALLOW_DOWNGRADED" | "BLOCK";

export interface BudgetCheck {
  decision: BudgetDecision;
  model: string;
  reason: RoutingReason;
  /** Message worth showing the user. Null when nothing notable happened. */
  message: string | null;
  monthToDateUsd: number;
  budgetUsd: number;
  estimatedCostUsd: number;
  remainingUsd: number;
  usedPct: number;
}

export interface BudgetCheckArgs {
  userId: string;
  timezone: string;
  feature: AiFeature;
  routingReason?: RoutingReason;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  imageCount?: number;
}

/**
 * Runs before every model call.
 *
 * 1. Read month-to-date spend.
 * 2. Estimate what this request will cost.
 * 3. Within budget → proceed on the routed model.
 * 4. Near budget → downgrade routine work to the cheap model and warn.
 * 5. Over budget → block optional features; essential work continues to the
 *    hard cap and then stops.
 */
export async function checkBudget(args: BudgetCheckArgs): Promise<BudgetCheck> {
  const config = env();
  const budgetUsd = config.AI_MONTHLY_BUDGET_USD;
  const routingReason = args.routingReason ?? "ROUTINE";
  const routed = routeModel(args.feature, routingReason);

  if (!config.AI_ENABLED) {
    return {
      decision: "BLOCK",
      model: routed.model,
      reason: routingReason,
      message: "AI features are disabled (AI_ENABLED=false).",
      monthToDateUsd: 0,
      budgetUsd,
      estimatedCostUsd: 0,
      remainingUsd: budgetUsd,
      usedPct: 0,
    };
  }

  const monthToDateUsd = await getMonthToDateCost(args.userId, args.timezone);
  const estimatedCostUsd = estimateRequestCost({
    model: routed.model,
    estimatedInputTokens: args.estimatedInputTokens,
    estimatedOutputTokens: args.estimatedOutputTokens,
    imageCount: args.imageCount,
  });

  const remainingUsd = Math.max(0, budgetUsd - monthToDateUsd);
  const usedPct = budgetUsd > 0 ? Math.round((monthToDateUsd / budgetUsd) * 1000) / 10 : 0;
  const projectedTotal = monthToDateUsd + estimatedCostUsd;
  const essential = ESSENTIAL_FEATURES.has(args.feature);

  const base = { monthToDateUsd, budgetUsd, estimatedCostUsd, remainingUsd, usedPct };

  // A zero budget means "no limit configured" rather than "spend nothing".
  if (budgetUsd <= 0) {
    return { decision: "ALLOW", model: routed.model, reason: routingReason, message: null, ...base };
  }

  if (projectedTotal > budgetUsd * HARD_CAP_MULTIPLIER) {
    return {
      decision: "BLOCK",
      model: routed.model,
      reason: routingReason,
      message: `Hard AI spending cap reached — ${formatUsd(monthToDateUsd)} used against a ${formatUsd(
        budgetUsd,
      )} monthly budget. Raise AI_MONTHLY_BUDGET_USD in Settings to continue.`,
      ...base,
    };
  }

  if (projectedTotal > budgetUsd) {
    if (!essential) {
      return {
        decision: "BLOCK",
        model: routed.model,
        reason: routingReason,
        message: `Monthly AI budget of ${formatUsd(budgetUsd)} is used up (${formatUsd(
          monthToDateUsd,
        )}). Optional AI features are paused until next month or until you raise the budget.`,
        ...base,
      };
    }
    const downgraded = routeModel(args.feature, "BUDGET_DOWNGRADE");
    return {
      decision: "ALLOW_DOWNGRADED",
      model: downgraded.model,
      reason: "BUDGET_DOWNGRADE",
      message: `Over the ${formatUsd(budgetUsd)} monthly budget — running extraction on ${
        downgraded.model
      } only. Optional AI features are paused.`,
      ...base,
    };
  }

  // Approaching the budget: keep essential work moving, but stop paying for the
  // expensive model on anything routine.
  if (monthToDateUsd >= budgetUsd * DOWNGRADE_THRESHOLD && routingReason === "ROUTINE") {
    const downgraded = routeModel(args.feature, "BUDGET_DOWNGRADE");
    if (downgraded.model !== routed.model) {
      return {
        decision: "ALLOW_DOWNGRADED",
        model: downgraded.model,
        reason: "BUDGET_DOWNGRADE",
        message: `${usedPct}% of the monthly AI budget used — switched to ${downgraded.model} to conserve spend.`,
        ...base,
      };
    }
    return {
      decision: "ALLOW",
      model: routed.model,
      reason: routingReason,
      message: `${usedPct}% of the monthly AI budget used.`,
      ...base,
    };
  }

  return { decision: "ALLOW", model: routed.model, reason: routingReason, message: null, ...base };
}

export class BudgetExceededError extends Error {
  constructor(
    message: string,
    readonly check: BudgetCheck,
  ) {
    super(message);
    this.name = "BudgetExceededError";
  }
}
