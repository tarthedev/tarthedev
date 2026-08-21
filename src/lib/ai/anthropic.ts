import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

import { env } from "@/lib/env";
import { estimateCost, type TokenUsage } from "@/lib/ai/models";
import {
  CoachBriefSchema,
  ExtractionResultSchema,
  normalizeExtraction,
  type CoachBrief,
  type ExtractionResult,
} from "@/lib/ai/schemas";
import {
  ANALYSIS_PROMPT_VERSION,
  ANALYSIS_SYSTEM_PROMPT,
  CHAT_PROMPT_VERSION,
  CHAT_SYSTEM_PROMPT,
  COACH_PROMPT_VERSION,
  COACH_SYSTEM_PROMPT,
  buildAnalysisUserPrompt,
  buildChatUserPrompt,
  buildCoachUserPrompt,
} from "@/lib/ai/prompts/coach";
import {
  EXTRACTION_PROMPT_VERSION,
  buildExtractionSystemPrompt,
  buildExtractionUserPrompt,
} from "@/lib/ai/prompts/extraction";
import type {
  AiProvider,
  AiResult,
  ChatRequest,
  CoachRequest,
  DeepAnalysisRequest,
  ExtractKpisRequest,
} from "@/lib/ai/types";

/** Raised when the model responds but the response is unusable. */
export class AiResponseError extends Error {
  constructor(
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "AiResponseError";
  }
}

type Effort = "low" | "medium" | "high";

function usageOf(usage: Anthropic.Usage): TokenUsage {
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
  };
}

function textOf(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic";
  private readonly client: Anthropic;

  constructor(client?: Anthropic) {
    this.client =
      client ??
      new Anthropic({
        apiKey: env().ANTHROPIC_API_KEY,
        // Two retries on 429/5xx, then the caller's own retry ladder takes over.
        maxRetries: 2,
        timeout: 120_000,
      });
  }

  async extractKpis(request: ExtractKpisRequest): Promise<AiResult<ExtractionResult>> {
    const strategy = request.strategy ?? "STANDARD";
    const promptArgs = {
      knownKpis: request.knownKpis,
      today: request.today,
      timezone: request.timezone,
      imageLabels: request.images.map((i) => i.label),
      strategy,
    };

    // Each image is announced by name immediately before its bytes so the model
    // can attribute every reading to a specific screenshot.
    const content: Anthropic.ContentBlockParam[] = [];
    for (const image of request.images) {
      content.push({ type: "text", text: image.label });
      content.push({
        type: "image",
        source: { type: "base64", media_type: image.mediaType, data: image.base64 },
      });
    }
    content.push({ type: "text", text: buildExtractionUserPrompt(promptArgs) });

    const started = Date.now();
    const response = await this.client.messages.parse({
      model: request.model,
      max_tokens: 8000,
      system: [
        {
          type: "text",
          text: buildExtractionSystemPrompt(promptArgs),
          // Stable across every extraction for a given KPI configuration.
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content }],
      output_config: {
        // Routine extraction is a reading task, not a reasoning task — low
        // effort keeps the per-snapshot cost down.
        effort: strategy === "EXPLICIT" ? "medium" : "low",
        format: zodOutputFormat(ExtractionResultSchema),
      },
    });
    const latencyMs = Date.now() - started;

    if (response.stop_reason === "refusal") {
      throw new AiResponseError("The model declined to process these screenshots.", response.stop_details);
    }
    if (!response.parsed_output) {
      throw new AiResponseError("Extraction did not return data matching the schema.", textOf(response.content));
    }

    return {
      data: normalizeExtraction(response.parsed_output),
      raw: response.parsed_output,
      meta: this.meta(request.model, EXTRACTION_PROMPT_VERSION, response.usage, latencyMs),
    };
  }

  async generateCoach(request: CoachRequest): Promise<AiResult<CoachBrief>> {
    const started = Date.now();
    const response = await this.client.messages.parse({
      model: request.model,
      max_tokens: 4000,
      system: [{ type: "text", text: COACH_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: buildCoachUserPrompt(request.context) }],
      output_config: { effort: "medium", format: zodOutputFormat(CoachBriefSchema) },
    });
    const latencyMs = Date.now() - started;

    if (!response.parsed_output) {
      throw new AiResponseError("Coach response did not match the schema.", textOf(response.content));
    }

    return {
      data: response.parsed_output,
      raw: response.parsed_output,
      meta: this.meta(request.model, COACH_PROMPT_VERSION, response.usage, latencyMs),
    };
  }

  async answerQuestion(request: ChatRequest): Promise<AiResult<string>> {
    const started = Date.now();
    const response = await this.client.messages.create({
      model: request.model,
      max_tokens: 1500,
      system: [{ type: "text", text: CHAT_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [
        ...request.history.map(
          (m): Anthropic.MessageParam => ({ role: m.role, content: m.content }),
        ),
        { role: "user", content: buildChatUserPrompt(request.context, request.question) },
      ],
      output_config: { effort: "low" },
    });
    const latencyMs = Date.now() - started;

    const answer = textOf(response.content);
    if (!answer) throw new AiResponseError("The model returned an empty answer.");

    return {
      data: answer,
      raw: response.content,
      meta: this.meta(request.model, CHAT_PROMPT_VERSION, response.usage, latencyMs),
    };
  }

  async deepAnalyze(request: DeepAnalysisRequest): Promise<AiResult<string>> {
    const started = Date.now();
    const response = await this.client.messages.create({
      model: request.model,
      max_tokens: 8000,
      system: [{ type: "text", text: ANALYSIS_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: buildAnalysisUserPrompt(request.context, request.focus) }],
      output_config: { effort: "high" },
    });
    const latencyMs = Date.now() - started;

    const answer = textOf(response.content);
    if (!answer) throw new AiResponseError("The model returned an empty analysis.");

    return {
      data: answer,
      raw: response.content,
      meta: this.meta(request.model, ANALYSIS_PROMPT_VERSION, response.usage, latencyMs),
    };
  }

  private meta(model: string, promptVersion: string, rawUsage: Anthropic.Usage, latencyMs: number) {
    const usage = usageOf(rawUsage);
    return {
      provider: this.name,
      model,
      promptVersion,
      usage,
      estimatedCostUsd: estimateCost(model, usage),
      latencyMs,
    };
  }
}

/** Maps SDK errors to a message worth showing a human. */
export function describeAiError(error: unknown): string {
  if (error instanceof AiResponseError) return error.message;
  if (error instanceof Anthropic.AuthenticationError)
    return "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.";
  if (error instanceof Anthropic.RateLimitError)
    return "Anthropic rate limit reached. Wait a moment and try again.";
  if (error instanceof Anthropic.BadRequestError) return `Anthropic rejected the request: ${error.message}`;
  if (error instanceof Anthropic.APIConnectionError)
    return "Could not reach the Anthropic API. Check the server's network access.";
  if (error instanceof Anthropic.APIError) return `Anthropic API error ${error.status}: ${error.message}`;
  if (error instanceof Error) return error.message;
  return "Unknown AI error.";
}

export type { Effort };
