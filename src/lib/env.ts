import { z } from "zod";

/**
 * Server-side configuration. Imported only from server code — a bundling
 * mistake that pulls this into the browser fails loudly here rather than
 * silently shipping secrets.
 */
if (typeof window !== "undefined") {
  throw new Error("src/lib/env.ts was imported from client code");
}

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((v) =>
    typeof v === "boolean" ? v : ["1", "true", "yes", "on"].includes(v.trim().toLowerCase()),
  );

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  /** Used to sign the session cookie. Must be long and random. */
  SESSION_SECRET: z
    .string()
    .min(32, "SESSION_SECRET must be at least 32 characters — generate with `openssl rand -base64 48`"),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),

  APP_URL: z.string().min(1).default("http://localhost:3000"),
  TIMEZONE: z.string().min(1).default("America/New_York"),

  // --- storage -------------------------------------------------------------
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_PATH: z.string().min(1).default("./storage"),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),

  // --- uploads -------------------------------------------------------------
  MAX_UPLOAD_MB: z.coerce.number().positive().default(15),
  MAX_IMAGES_PER_SNAPSHOT: z.coerce.number().int().positive().default(30),

  // --- AI ------------------------------------------------------------------
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_ENABLED: booleanish.default(true),
  /**
   * Dev mode swaps the Anthropic provider for a deterministic mock so the whole
   * pipeline can be exercised without spending money.
   */
  AI_DEV_MODE: booleanish.default(false),

  AI_EXTRACTION_MODEL: z.string().default("claude-sonnet-5"),
  AI_COACH_MODEL: z.string().default("claude-sonnet-5"),
  AI_CHAT_MODEL: z.string().default("claude-sonnet-5"),
  AI_DEEP_ANALYSIS_MODEL: z.string().default("claude-opus-5"),
  /** Model used when a routine extraction comes back ambiguous. */
  AI_ESCALATION_MODEL: z.string().default("claude-opus-5"),

  AI_MONTHLY_BUDGET_USD: z.coerce.number().nonnegative().default(10),
  AI_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.8),
  AI_MAX_EXTRACTION_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(3),
  /**
   * JSON map overriding the built-in price table when Anthropic changes rates,
   * e.g. {"claude-sonnet-5":{"input":3,"output":15}} in USD per million tokens.
   */
  AI_PRICE_OVERRIDES: z.string().optional(),

  // --- rate limiting -------------------------------------------------------
  RATE_LIMIT_LOGIN_PER_15MIN: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_UPLOAD_PER_HOUR: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_AI_PER_HOUR: z.coerce.number().int().positive().default(120),

  /** Allows creating the first account. Set false once you have signed up. */
  ALLOW_REGISTRATION: booleanish.default(true),
});

export type AppEnv = z.infer<typeof schema>;

function load(): AppEnv {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const value = parsed.data;

  // The API key is only genuinely required when we intend to call the API.
  if (value.AI_ENABLED && !value.AI_DEV_MODE && !value.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is required when AI_ENABLED=true. Set AI_DEV_MODE=true to run against the mock provider instead.",
    );
  }
  return value;
}

let cached: AppEnv | null = null;

export function env(): AppEnv {
  cached ??= load();
  return cached;
}

/** True when AI calls should hit the mock provider rather than the network. */
export function isMockAi(): boolean {
  const e = env();
  return e.AI_DEV_MODE || !e.ANTHROPIC_API_KEY;
}
