import { randomUUID } from "node:crypto";
import { type Database, employees, user } from "@dwrg/db";
import { createTestDatabase, type TestDatabase } from "@dwrg/db/testing";
import { type ApiErrorBody, apiErrorSchema, type Role } from "@dwrg/shared";
import type { z } from "zod";
import { type App, createApp } from "../src/app";
import { type Auth, createAuth } from "../src/auth";
import { type ApiEnv, parseEnv } from "../src/env";
import { createLogger, type Logger, silentLogger } from "../src/logger";
import { hashPassword, setCredentialPassword } from "../src/services/logins";

/**
 * One throwaway database and app per test file:
 *
 *   let t: TestApp;
 *   beforeAll(async () => { t = await setupTestApp(); });
 *   afterAll(async () => { await t?.close(); });
 */

export const WEB_ORIGIN = "http://localhost:5173";
export const API_ORIGIN = "http://localhost:8787";
export const TEST_PASSWORD = "correct-horse-battery";

export interface TestApp {
  app: App;
  auth: Auth;
  db: Database;
  env: ApiEnv;
  database: TestDatabase;
  /** Log lines the app wrote (parsed JSON), for assertions. */
  logs: Record<string, unknown>[];
  close: () => Promise<void>;
}

export function testEnv(databaseUrl: string, overrides: Record<string, string> = {}): ApiEnv {
  return parseEnv({
    NODE_ENV: "test",
    DATABASE_URL: databaseUrl,
    BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters-long",
    BETTER_AUTH_URL: API_ORIGIN,
    WEB_ORIGIN,
    LOG_LEVEL: "debug",
    ...overrides,
  });
}

export interface SetupOptions {
  /** Pin "today" (business-local) for equipment ages. */
  now?: () => Date;
}

export async function setupTestApp(options: SetupOptions = {}): Promise<TestApp> {
  const database = await createTestDatabase();
  const env = testEnv(database.url);
  const logs: Record<string, unknown>[] = [];
  const logger: Logger = createLogger({
    level: "debug",
    write: (line) => logs.push(JSON.parse(line) as Record<string, unknown>),
  });
  const auth = createAuth({ db: database.db, env, logger: silentLogger });
  const app = createApp({ db: database.db, auth, env, logger, now: options.now });
  return { app, auth, db: database.db, env, database, logs, close: database.close };
}

export interface LoginSpec {
  role: Role;
  name?: string;
  email?: string;
  password?: string;
  active?: boolean;
  /** Also create the employees row (default true). */
  employee?: boolean;
  phone?: string;
}

export interface CreatedLogin {
  id: string;
  name: string;
  email: string;
  role: Role;
  password: string;
}

/** A user with an email-and-password login, written the way Better Auth reads it. */
export async function createLogin(t: TestApp, spec: LoginSpec): Promise<CreatedLogin> {
  const id = randomUUID();
  const name = spec.name ?? `Test ${spec.role}`;
  const email = spec.email ?? `${spec.role}.${id.slice(0, 8)}@test.dwrg.example`;
  const password = spec.password ?? TEST_PASSWORD;
  await t.db.insert(user).values({
    id,
    name,
    email,
    role: spec.role,
    active: spec.active ?? true,
    emailVerified: true,
  });
  await setCredentialPassword(t.db, id, await hashPassword(t.auth, password), {
    userId: null,
    reason: "test setup",
  });
  if (spec.employee ?? true) {
    await t.db.insert(employees).values({
      userId: id,
      phone: spec.phone ?? null,
      skills: spec.role === "tech" ? ["hvac"] : [],
      businessUnits: ["hvac_service"],
    });
  }
  return { id, name, email, role: spec.role, password };
}

export function signInRequest(email: string, password: string): Request {
  return new Request(`${API_ORIGIN}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: WEB_ORIGIN },
    body: JSON.stringify({ email, password }),
  });
}

/** Signs in through Better Auth's endpoint; returns the Cookie header to send. */
export async function signIn(t: TestApp, email: string, password: string): Promise<string> {
  const res = await t.app.request(signInRequest(email, password));
  if (res.status !== 200) {
    throw new Error(`sign-in failed: ${res.status} ${await res.text()}`);
  }
  const cookie = cookieHeader(res);
  if (!cookie) throw new Error("sign-in set no cookie");
  return cookie;
}

/** A login plus a signed-in cookie for it. */
export async function loginAs(
  t: TestApp,
  spec: LoginSpec,
): Promise<CreatedLogin & { cookie: string }> {
  const login = await createLogin(t, spec);
  return { ...login, cookie: await signIn(t, login.email, login.password) };
}

/** `name=value; name2=value2` from a response's Set-Cookie headers. */
export function cookieHeader(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0] ?? "")
    .filter((pair) => pair && !pair.endsWith("="))
    .join("; ");
}

/** GET (or other method) with a session cookie, as the web app sends it. */
export function call(
  t: TestApp,
  path: string,
  init: { cookie?: string; method?: string; json?: unknown; headers?: Record<string, string> } = {},
): Promise<Response> {
  const headers: Record<string, string> = { Origin: WEB_ORIGIN, ...init.headers };
  if (init.cookie) headers.Cookie = init.cookie;
  let body: string | undefined;
  if (init.json !== undefined) {
    headers["Content-Type"] ??= "application/json";
    body = JSON.stringify(init.json);
  }
  return Promise.resolve(
    t.app.request(`${API_ORIGIN}${path}`, {
      method: init.method ?? (body === undefined ? "GET" : "POST"),
      headers,
      body,
    }),
  );
}

/**
 * The response body, checked against its @dwrg/shared schema (strictly: no
 * extra fields), so every test also proves the API keeps its contract.
 */
export async function bodyAs<T extends z.ZodObject>(schema: T, res: Response): Promise<z.infer<T>> {
  const data: unknown = await res.json();
  schema.strict().parse(data);
  return schema.parse(data);
}

/** An error response in the shared shape. */
export async function errorOf(res: Response): Promise<ApiErrorBody["error"]> {
  return apiErrorSchema.parse(await res.json()).error;
}
