import { env } from "@/lib/env";

/**
 * Model catalogue and price table.
 *
 * Prices are USD per million tokens and are *estimates* used for the budget
 * guardrail and the cost dashboard — they are not an invoice. Anthropic changes
 * rates, so anything here can be overridden at runtime with AI_PRICE_OVERRIDES
 * without a redeploy, and an unknown model degrades to a conservative default
 * rather than reporting $0.
 */
export interface ModelPricing {
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M output tokens. */
  output: number;
  /** Promotional rate, applied while `introUntil` has not passed. */
  introInput?: number;
  introOutput?: number;
  /** ISO date the promotional rate stops applying. */
  introUntil?: string;
}

/** Cache writes cost 1.25× the input rate; cache reads cost 0.1×. */
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

/** Verified against Anthropic's published pricing on 2026-06-24. */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-sonnet-5": {
    input: 3,
    output: 15,
    introInput: 2,
    introOutput: 10,
    introUntil: "2026-08-31",
  },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-fable-5": { input: 10, output: 50 },
};

/** Used when a configured model is not in the table — priced as top-tier so the
 *  budget guard errs toward caution rather than under-reporting spend. */
const FALLBACK_PRICING: ModelPricing = { input: 5, output: 25 };

let overridesCache: Record<string, Partial<ModelPricing>> | null = null;

function overrides(): Record<string, Partial<ModelPricing>> {
  if (overridesCache) return overridesCache;
  const raw = env().AI_PRICE_OVERRIDES;
  if (!raw) {
    overridesCache = {};
    return overridesCache;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    overridesCache =
      parsed && typeof parsed === "object" ? (parsed as Record<string, Partial<ModelPricing>>) : {};
  } catch {
    // A malformed override must not take the app down; fall back to the table.
    overridesCache = {};
  }
  return overridesCache;
}

export function pricingFor(model: string, at: Date = new Date()): ModelPricing {
  const base = MODEL_PRICING[model] ?? FALLBACK_PRICING;
  const merged: ModelPricing = { ...base, ...(overrides()[model] ?? {}) };

  const introActive =
    merged.introUntil !== undefined &&
    merged.introInput !== undefined &&
    merged.introOutput !== undefined &&
    at.toISOString().slice(0, 10) <= merged.introUntil;

  return introActive
    ? { ...merged, input: merged.introInput as number, output: merged.introOutput as number }
    : merged;
}

export function isKnownModel(model: string): boolean {
  return model in MODEL_PRICING || model in overrides();
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

/** Estimated USD for one request. */
export function estimateCost(model: string, usage: TokenUsage, at: Date = new Date()): number {
  const price = pricingFor(model, at);
  const perToken = (rate: number) => rate / 1_000_000;

  const cost =
    usage.inputTokens * perToken(price.input) +
    usage.outputTokens * perToken(price.output) +
    (usage.cacheCreationTokens ?? 0) * perToken(price.input * CACHE_WRITE_MULTIPLIER) +
    (usage.cacheReadTokens ?? 0) * perToken(price.input * CACHE_READ_MULTIPLIER);

  // Six decimals keeps sub-cent calls meaningful without float noise.
  return Math.round(cost * 1_000_000) / 1_000_000;
}

/**
 * Pre-flight estimate used by the budget guard, before any tokens are spent.
 * Images dominate extraction cost: a resized dashboard screenshot lands around
 * 1,200–1,600 tokens.
 */
export const TOKENS_PER_IMAGE_ESTIMATE = 1500;

export function estimateRequestCost(args: {
  model: string;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  imageCount?: number;
}): number {
  return estimateCost(args.model, {
    inputTokens: args.estimatedInputTokens + (args.imageCount ?? 0) * TOKENS_PER_IMAGE_ESTIMATE,
    outputTokens: args.estimatedOutputTokens,
  });
}

export function formatUsd(value: number): string {
  if (value === 0) return "$0.00";
  if (Math.abs(value) < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}
