import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { config } from "./config.js";

export type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;
export type ContentBlock = Anthropic.Beta.Messages.BetaContentBlock;
export type ContentBlockParam = Anthropic.Beta.Messages.BetaContentBlockParam;
export type TextBlockParam = Anthropic.Beta.Messages.BetaTextBlockParam;
export type ToolParam = Anthropic.Beta.Messages.BetaTool;
export type ToolResultBlockParam = Anthropic.Beta.Messages.BetaToolResultBlockParam;
export type ToolUseBlock = Anthropic.Beta.Messages.BetaToolUseBlock;
export type Message = Anthropic.Beta.Messages.BetaMessage;

// Server-side refusal fallback: if the model declines, the API re-runs the
// request on Anthropic's recommended fallback model instead of failing the call.
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

let client: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (!config.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
  client ??= new Anthropic({ apiKey: config.ANTHROPIC_API_KEY, maxRetries: 1 });
  return client;
}

/**
 * Prepare an assistant turn for the history we send back next time.
 * After a mid-output fallback, blocks before the last `fallback` marker other than
 * text must be dropped; the marker itself is optional, so we drop it.
 */
export function historyContent(content: ContentBlock[]): ContentBlockParam[] {
  let lastFallback = -1;
  content.forEach((b, i) => {
    if ((b as { type: string }).type === "fallback") lastFallback = i;
  });
  const out: ContentBlockParam[] = [];
  content.forEach((b, i) => {
    const type = (b as { type: string }).type;
    if (type === "fallback") return;
    if (i < lastFallback && type !== "text") return;
    out.push(b as ContentBlockParam);
  });
  return out;
}

/** One-shot structured generation for background work (preview copy, call summaries). */
export async function generateStructured<T extends z.ZodType>(opts: {
  schema: T;
  system: string;
  prompt: string;
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
}): Promise<z.infer<T>> {
  const res = await anthropic().beta.messages.parse({
    model: config.WORKER_MODEL,
    max_tokens: opts.maxTokens ?? 16000,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    system: opts.system,
    messages: [{ role: "user", content: opts.prompt }],
    output_config: { effort: opts.effort ?? "medium", format: betaZodOutputFormat(opts.schema) },
  });
  if (res.stop_reason === "refusal") throw new Error("The model declined this request");
  if (res.parsed_output == null) throw new Error(`No structured output (stop_reason=${res.stop_reason})`);
  return res.parsed_output as z.infer<T>;
}

/** Plain text generation for background work. */
export async function generateText(opts: { system: string; prompt: string; maxTokens?: number }): Promise<string> {
  const res = await anthropic().beta.messages.create({
    model: config.WORKER_MODEL,
    max_tokens: opts.maxTokens ?? 4000,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    system: opts.system,
    messages: [{ role: "user", content: opts.prompt }],
    output_config: { effort: "low" },
  });
  if (res.stop_reason === "refusal") throw new Error("The model declined this request");
  return res.content
    .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}
