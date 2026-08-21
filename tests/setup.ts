/**
 * Test environment.
 *
 * Loaded by Vitest before any module is imported, because `src/lib/env.ts`
 * validates configuration at import time. Nothing here connects to a real
 * database or the Anthropic API — the suite covers pure logic only.
 */
// NODE_ENV is typed read-only, so the whole block goes through a mutable view.
const env = process.env as Record<string, string | undefined>;

env.NODE_ENV ??= "test";
env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
env.SESSION_SECRET ??= "test-only-session-secret-long-enough-for-validation";
env.AI_DEV_MODE ??= "true";
env.AI_MONTHLY_BUDGET_USD ??= "10";
env.TIMEZONE ??= "America/New_York";
