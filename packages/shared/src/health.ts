import { z } from "zod";

/**
 * GET /health (no login). 200 with status "ok" when the API can run
 * `SELECT 1` on Postgres within about 2 seconds, 503 with "unavailable"
 * otherwise (docs/runbooks/monitoring.md, "The /health contract").
 */
export const healthResponseSchema = z.object({
  status: z.enum(["ok", "unavailable"]),
  database: z.enum(["ok", "down"]),
  /** The deployed commit (APP_VERSION), "dev" locally. */
  version: z.string(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;
