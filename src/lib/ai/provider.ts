import { AnthropicProvider } from "@/lib/ai/anthropic";
import { MockAiProvider } from "@/lib/ai/mock";
import { env, isMockAi } from "@/lib/env";
import type { AiFeature, AiProvider } from "@/lib/ai/types";

let cached: AiProvider | null = null;

export function getAiProvider(): AiProvider {
  cached ??= isMockAi() ? new MockAiProvider() : new AnthropicProvider();
  return cached;
}

/** Test seam — lets a suite inject a stub without touching env. */
export function setAiProvider(provider: AiProvider | null): void {
  cached = provider;
}

export type RoutingReason =
  | "ROUTINE"
  | "LOW_CONFIDENCE"
  | "CONFLICT"
  | "RETRY_ESCALATION"
  | "USER_REQUESTED_DEEP"
  | "BUDGET_DOWNGRADE";

export interface ModelChoice {
  model: string;
  reason: RoutingReason;
}

/**
 * Model routing.
 *
 * Tier 1 (Sonnet by default) handles everything routine. Tier 2 (Opus) is
 * reserved for work that has actually earned it: an extraction that came back
 * ambiguous, a screenshot conflict, or an explicit request for deep analysis.
 * Every model id is configurable, because availability and pricing change.
 */
export function routeModel(feature: AiFeature, reason: RoutingReason = "ROUTINE"): ModelChoice {
  const config = env();

  if (reason === "BUDGET_DOWNGRADE") {
    return { model: config.AI_EXTRACTION_MODEL, reason };
  }

  switch (feature) {
    case "SCREENSHOT_EXTRACTION":
      return reason === "LOW_CONFIDENCE" || reason === "CONFLICT" || reason === "RETRY_ESCALATION"
        ? { model: config.AI_ESCALATION_MODEL, reason }
        : { model: config.AI_EXTRACTION_MODEL, reason };

    case "COACH_BRIEF":
      return { model: config.AI_COACH_MODEL, reason };

    case "CHAT":
      return { model: config.AI_CHAT_MODEL, reason };

    case "DEEP_ANALYSIS":
      return { model: config.AI_DEEP_ANALYSIS_MODEL, reason };
  }
}
