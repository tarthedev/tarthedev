import { randomUUID } from "node:crypto";
import { account, type Database, session, user, verification } from "@dwrg/db";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@dwrg/shared";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import { type ApiEnv, isProduction } from "./env";
import type { Logger } from "./logger";

/**
 * Better Auth on our own `user`, `session`, `account` and `verification`
 * tables (@dwrg/db), mounted at /api/auth/*.
 *
 * - Email and password only. No public sign-up: owners and managers create
 *   logins through POST /api/employees.
 * - Only the endpoints in AUTH_PUBLIC_PATHS are served over HTTP (app.ts),
 *   so nothing changes a login without an audit_log row.
 * - `role` and `active` are our columns on `user`. Neither can be set through
 *   Better Auth's endpoints (`input: false`).
 * - A turned-off login (`active = false`) can't start a session, and
 *   requireSession rejects any session it still has.
 * - Cookies are Secure in production, HttpOnly and SameSite=Lax always.
 */

/** Better Auth's account provider id for email-and-password logins. */
export const CREDENTIAL_PROVIDER_ID = "credential";

/** Where Better Auth is mounted (app.ts and infra/Caddyfile agree on it). */
export const AUTH_BASE_PATH = "/api/auth";

/**
 * The only Better Auth endpoints reachable over HTTP (below AUTH_BASE_PATH):
 * signing in and out, and reading or ending your own sessions. Everything
 * else Better Auth offers answers 404. Its self-service endpoints
 * (update-user, change-password, change-email, delete-user, password reset,
 * ...) write `user` and `account` rows without an audit_log entry
 * (CLAUDE.md rule 4), so login changes go through our own audited endpoints
 * (POST /api/employees today). An allow-list keeps endpoints that future
 * Better Auth versions add closed until we choose to open them.
 */
export const AUTH_PUBLIC_PATHS: ReadonlySet<string> = new Set([
  "/sign-in/email",
  "/sign-out",
  "/get-session",
  "/list-sessions",
  "/revoke-session",
  "/revoke-sessions",
  "/revoke-other-sessions",
]);

/** Whether an HTTP request to `path` (the full path, e.g. /api/auth/sign-in/email) may reach Better Auth. */
export function isPublicAuthPath(path: string): boolean {
  return (
    path.startsWith(`${AUTH_BASE_PATH}/`) &&
    AUTH_PUBLIC_PATHS.has(path.slice(AUTH_BASE_PATH.length))
  );
}

export const SESSION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 7;

export interface CreateAuthOptions {
  db: Database;
  env: Pick<
    ApiEnv,
    "NODE_ENV" | "BETTER_AUTH_SECRET" | "BETTER_AUTH_URL" | "WEB_ORIGIN" | "LOG_LEVEL"
  >;
  logger?: Logger;
}

export function createAuth({ db, env, logger }: CreateAuthOptions) {
  const production = isProduction(env);
  return betterAuth({
    appName: "DWRG",
    baseURL: env.BETTER_AUTH_URL,
    basePath: AUTH_BASE_PATH,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [...new Set([env.WEB_ORIGIN, env.BETTER_AUTH_URL])],
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: { user, session, account, verification },
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
    },
    user: {
      additionalFields: {
        role: { type: "string", required: false, input: false, defaultValue: "tech" },
        active: { type: "boolean", required: false, input: false, defaultValue: true },
      },
    },
    session: {
      expiresIn: SESSION_EXPIRES_IN_SECONDS,
      updateAge: 60 * 60 * 24,
    },
    databaseHooks: {
      session: {
        create: {
          before: async (newSession) => {
            const [row] = await db
              .select({ active: user.active })
              .from(user)
              .where(eq(user.id, newSession.userId));
            if (!row?.active) {
              throw APIError.from("FORBIDDEN", {
                code: "LOGIN_TURNED_OFF",
                message: "This login is turned off. Ask an owner or manager.",
              });
            }
          },
        },
      },
    },
    rateLimit: { enabled: production, storage: "memory" },
    advanced: {
      useSecureCookies: production,
      cookiePrefix: "dwrg",
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
      database: { generateId: () => randomUUID() },
    },
    telemetry: { enabled: false },
    logger: {
      level: env.LOG_LEVEL === "debug" ? "debug" : "warn",
      log: (level, message, ...args) => {
        if (!logger) return;
        const fields =
          args.length > 0 ? { source: "better-auth", args } : { source: "better-auth" };
        logger[level === "debug" ? "debug" : level](message, fields);
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

/**
 * Better Auth's sign-in and get-session bodies include the session token
 * (`token`, `session.token`) for bearer-token clients. We only use the
 * HttpOnly cookie, so the token is removed from JSON bodies: page scripts
 * never see the secret the cookie hides. Everything else, including
 * Set-Cookie headers, passes through unchanged.
 */
export async function withoutSessionTokens(res: Response): Promise<Response> {
  if (!/^application\/json/i.test(res.headers.get("Content-Type") ?? "")) return res;
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return rebuild(res, text);
  }
  let changed = false;
  /** A copy of `value` without `token`, when it is an object that has one. */
  const strip = (value: unknown): unknown => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
    if (!("token" in value)) return value;
    const { token: _token, ...rest } = value as Record<string, unknown>;
    changed = true;
    return rest;
  };
  let out: unknown;
  if (Array.isArray(body)) {
    // list-sessions: one entry per session.
    out = body.map(strip);
  } else if (body !== null && typeof body === "object") {
    // sign-in and change-password (`token`), get-session (`session.token`).
    const top = strip(body) as Record<string, unknown>;
    out = "session" in top ? { ...top, session: strip(top.session) } : top;
  } else {
    out = body;
  }
  return rebuild(res, changed ? JSON.stringify(out) : text);
}

function rebuild(res: Response, body: string): Response {
  const headers = new Headers(res.headers);
  headers.delete("Content-Length");
  return new Response(body, { status: res.status, statusText: res.statusText, headers });
}
