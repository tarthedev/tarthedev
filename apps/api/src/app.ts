import { randomUUID } from "node:crypto";
import type { Database } from "@dwrg/db";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { csrf } from "hono/csrf";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import { type Auth, withoutSessionTokens } from "./auth";
import type { AppEnv, AuthedEnv, AuthedVariables } from "./context";
import type { ApiEnv } from "./env";
import { ApiError, handleError, handleNotFound } from "./errors";
import { createLogger, type Logger } from "./logger";
import { auditContext, requireSession } from "./middleware/session";
import { customerRoutes } from "./routes/customers";
import { employeeRoutes } from "./routes/employees";
import { healthRoutes } from "./routes/health";
import { type ImportFileStore, importRoutes, isImportUpload } from "./routes/imports";
import { meRoutes } from "./routes/me";
import { pricebookRoutes } from "./routes/pricebook";

/** JSON bodies bigger than this are refused (413). File uploads have their own limit (routes/imports.ts). */
export const MAX_JSON_BODY_BYTES = 1024 * 1024;

/** Requests slower than this are logged as warnings ("slow request"). */
export const SLOW_REQUEST_MS = 1000;

export interface CreateAppOptions {
  db: Database;
  auth: Auth;
  env: ApiEnv;
  /** Default: JSON lines on stdout at env.LOG_LEVEL. */
  logger?: Logger;
  /** The clock for "today" (e.g. equipment ages). Tests pin it. */
  now?: () => Date;
  /** Where uploaded ServiceTitan exports are kept unchanged; none yet (see routes/imports.ts). */
  importFileStore?: ImportFileStore;
}

/**
 * The API as a Hono app. src/server.ts serves it on Node; tests call
 * `app.request(...)` directly.
 *
 * URL contract with Caddy (infra/Caddyfile): /health and everything under
 * /api go to the API unchanged; Better Auth lives at /api/auth/*.
 */
export function createApp({ db, auth, env, logger, now, importFileStore }: CreateAppOptions) {
  const rootLog =
    logger ??
    createLogger({
      level: env.LOG_LEVEL,
      base: { service: "api", env: env.DWRG_ENV, version: env.APP_VERSION },
    });
  const trustedOrigins = [...new Set([env.WEB_ORIGIN, env.BETTER_AUTH_URL])];

  const app = new Hono<AppEnv>();

  // 1. Request id (X-Request-Id: a sane incoming one is kept, else a new uuid) and logging.
  app.use("*", requestId({ generator: () => randomUUID() }));
  app.use("*", async (c, next) => {
    const log = rootLog.child({ requestId: c.get("requestId") });
    c.set("log", log);
    const started = performance.now();
    await next();
    const durationMs = Math.round(performance.now() - started);
    const status = c.res.status;
    const user = (c.var as Partial<AuthedVariables>).user;
    const fields = {
      method: c.req.method,
      // The path only: query strings can carry search text and, later, one-time tokens.
      path: c.req.path,
      status,
      durationMs,
      ...(user ? { userId: user.id, role: user.role } : {}),
    };
    if (status >= 500) log.error("request", fields);
    else if (durationMs >= SLOW_REQUEST_MS) log.warn("slow request", fields);
    else if (c.req.path === "/health") log.debug("request", fields);
    else log.info("request", fields);
  });

  // 2. Headers for a JSON API: nothing here is a page, a frame or cacheable.
  app.use(
    "*",
    secureHeaders({
      contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      crossOriginResourcePolicy: "same-site",
      xFrameOptions: "DENY",
    }),
  );
  app.use("*", async (c, next) => {
    await next();
    if (!c.res.headers.has("Cache-Control")) c.header("Cache-Control", "no-store");
  });

  // 3. Browser access: only the web app's origin, with cookies.
  app.use(
    "/api/*",
    cors({
      origin: env.WEB_ORIGIN,
      credentials: true,
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "X-Request-Id"],
      exposeHeaders: ["X-Request-Id"],
      maxAge: 600,
    }),
  );
  // Cross-site form posts are refused (JSON endpoints also require application/json).
  app.use("/api/*", csrf({ origin: trustedOrigins }));
  const jsonBodyLimit = bodyLimit({
    maxSize: MAX_JSON_BODY_BYTES,
    onError: () => {
      throw new ApiError(413, "payload_too_large", "The request body is too large.");
    },
  });
  app.use("/api/*", (c, next) =>
    isImportUpload(c.req.method, c.req.path) ? next() : jsonBodyLimit(c, next),
  );

  // 4. Routes. No login: /health and Better Auth's own endpoints.
  app.route("/", healthRoutes({ db, env }));
  // Sign-up is turned off in Better Auth; logins are created through POST /api/employees.
  app.on(["GET", "POST"], "/api/auth/*", async (c) =>
    withoutSessionTokens(await auth.handler(c.req.raw)),
  );

  // Everything else under /api needs a session; each route states its roles.
  const api = new Hono<AuthedEnv>();
  api.use("*", requireSession(auth), auditContext());
  api.route("/", meRoutes({ db }));
  api.route("/customers", customerRoutes({ db, now }));
  api.route("/employees", employeeRoutes({ db, auth }));
  api.route("/imports", importRoutes({ db, fileStore: importFileStore }));
  api.route("/pricebook", pricebookRoutes({ db }));
  app.route("/api", api);

  app.onError(handleError);
  app.notFound(handleNotFound);
  return app;
}

export type App = ReturnType<typeof createApp>;
