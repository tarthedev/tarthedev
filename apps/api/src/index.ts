/**
 * @dwrg/api: the Hono API. src/server.ts runs it on Node; tests and tools
 * import createApp and createAuth from here.
 */

export { type App, type CreateAppOptions, createApp } from "./app";
export { type Auth, CREDENTIAL_PROVIDER_ID, type CreateAuthOptions, createAuth } from "./auth";
export type { AppEnv, AuthedEnv, RequestAudit, SessionUser } from "./context";
export { type ApiEnv, InvalidEnvError, parseEnv } from "./env";
export { ApiError } from "./errors";
export { createLogger, type Logger, silentLogger } from "./logger";
export { auditContext, requireRole, requireSession } from "./middleware/session";
