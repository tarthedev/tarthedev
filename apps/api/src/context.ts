import type { AuditContext, Database } from "@dwrg/db";
import type { Role } from "@dwrg/shared";
import type { Auth } from "./auth";
import type { ApiEnv } from "./env";
import type { Logger } from "./logger";

/** What createApp needs. Tests pass a throwaway database and a silent logger. */
export interface AppDeps {
  db: Database;
  auth: Auth;
  env: ApiEnv;
  logger: Logger;
}

/** Variables every request has (set by the first middlewares in app.ts). */
export interface AppVariables {
  requestId: string;
  /** The request's logger: every line carries the request id. */
  log: Logger;
}

export type AppEnv = { Variables: AppVariables };

/** The signed-in person, as requireSession leaves it on the context. */
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  image: string | null;
}

export interface SessionInfo {
  id: string;
  expiresAt: Date;
}

/**
 * The per-request audit context (CLAUDE.md rule 4). Money and data writes
 * pass `audit.ctx("why")` to the @dwrg/db audit helpers, so every change is
 * recorded with who made it and why, in the same transaction.
 */
export interface RequestAudit {
  readonly userId: string;
  readonly requestId: string;
  ctx(reason: string): AuditContext;
}

export interface AuthedVariables extends AppVariables {
  user: SessionUser;
  session: SessionInfo;
  audit: RequestAudit;
}

/** Routers behind requireSession use this env, so `c.get("user")` is typed. */
export type AuthedEnv = { Variables: AuthedVariables };
