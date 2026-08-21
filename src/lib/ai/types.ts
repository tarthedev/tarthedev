import type { CoachBrief, ExtractionResult } from "@/lib/ai/schemas";
import type { TokenUsage } from "@/lib/ai/models";

export type AiFeature = "SCREENSHOT_EXTRACTION" | "COACH_BRIEF" | "CHAT" | "DEEP_ANALYSIS";

export interface AiCallMeta {
  provider: string;
  model: string;
  promptVersion: string;
  usage: TokenUsage;
  estimatedCostUsd: number;
  latencyMs: number;
}

export interface AiResult<T> {
  data: T;
  meta: AiCallMeta;
  /** Verbatim model output, stored for auditing. */
  raw: unknown;
}

export interface ImagePayload {
  /** Stable handle the model cites, e.g. "screenshot_1". */
  label: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp";
  base64: string;
}

export interface ExtractKpisRequest {
  images: ImagePayload[];
  /** KPI keys and labels the user has defined, so the model echoes known keys. */
  knownKpis: { key: string; displayName: string; aliases: string[] }[];
  /** Today in the user's timezone, to resolve relative period labels. */
  today: string;
  timezone: string;
  model: string;
  /** A more prescriptive prompt used on retry. */
  strategy?: "STANDARD" | "EXPLICIT";
}

export interface CoachRequest {
  /** Pre-computed, compact context. The provider never receives the database. */
  context: string;
  model: string;
}

export interface ChatRequest {
  context: string;
  question: string;
  history: { role: "user" | "assistant"; content: string }[];
  model: string;
}

export interface DeepAnalysisRequest {
  context: string;
  focus?: string;
  model: string;
}

/**
 * The only surface the application uses to reach a model. Swapping providers or
 * models never touches calling code.
 */
export interface AiProvider {
  readonly name: string;
  extractKpis(request: ExtractKpisRequest): Promise<AiResult<ExtractionResult>>;
  generateCoach(request: CoachRequest): Promise<AiResult<CoachBrief>>;
  answerQuestion(request: ChatRequest): Promise<AiResult<string>>;
  deepAnalyze(request: DeepAnalysisRequest): Promise<AiResult<string>>;
}
