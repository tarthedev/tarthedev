import { z } from "zod";

/**
 * The API's settings, read once at startup from environment variables
 * (infra/.env.production.example on the droplet, the repo-root .env locally).
 * A missing or invalid setting stops the server with a clear message instead
 * of failing on the first request.
 */

const urlOrigin = z
  .url({ protocol: /^https?$/, error: "Must be an http(s) URL" })
  .transform((value) => new URL(value).origin);

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    /** production or staging on the droplet; "local" otherwise. */
    DWRG_ENV: z.string().min(1).default("local"),
    /** The deployed commit (set in the image); "dev" locally. */
    APP_VERSION: z.string().min(1).default("dev"),
    PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
    HOST: z.string().min(1).default("0.0.0.0"),
    DATABASE_URL: z.string().min(1, { error: "DATABASE_URL is required" }),
    BETTER_AUTH_SECRET: z.string().min(1, { error: "BETTER_AUTH_SECRET is required" }),
    /** This API's public address (https://app.<domain> in production). */
    BETTER_AUTH_URL: urlOrigin,
    /** Where the web app is served from: the only origin allowed to call with cookies. */
    WEB_ORIGIN: urlOrigin,
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== "production") return;
    if (env.BETTER_AUTH_SECRET.length < 32 || /change[-_]?me/i.test(env.BETTER_AUTH_SECRET)) {
      ctx.addIssue({
        code: "custom",
        path: ["BETTER_AUTH_SECRET"],
        message: "Use a random secret of at least 32 characters (openssl rand -hex 32)",
      });
    }
    for (const key of ["BETTER_AUTH_URL", "WEB_ORIGIN"] as const) {
      if (!env[key].startsWith("https://")) {
        ctx.addIssue({ code: "custom", path: [key], message: "Must be https in production" });
      }
    }
  });

export type ApiEnv = z.infer<typeof envSchema>;
export type ApiEnvInput = z.input<typeof envSchema>;

export class InvalidEnvError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid API settings:\n  ${problems.join("\n  ")}`);
    this.name = "InvalidEnvError";
  }
}

/** Parses settings from `source` (default process.env). Throws InvalidEnvError listing every problem. */
export function parseEnv(source: Record<string, string | undefined> = process.env): ApiEnv {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new InvalidEnvError(
      result.error.issues.map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`),
    );
  }
  return result.data;
}

export const isProduction = (env: Pick<ApiEnv, "NODE_ENV">): boolean =>
  env.NODE_ENV === "production";
