import { createDb } from "@dwrg/db";
import { databaseUrl } from "@dwrg/db/testing";
import { healthResponseSchema } from "@dwrg/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { createAuth } from "../src/auth";
import { silentLogger } from "../src/logger";
import { API_ORIGIN, bodyAs, errorOf, setupTestApp, type TestApp, testEnv } from "./helpers";

let t: TestApp;
beforeAll(async () => {
  t = await setupTestApp();
});
afterAll(async () => {
  await t?.close();
});

describe("GET /health", () => {
  it("is 200 ok when the database answers, with no login", async () => {
    const res = await t.app.request(`${API_ORIGIN}/health`);
    expect(res.status).toBe(200);
    expect(await bodyAs(healthResponseSchema, res)).toEqual({
      status: "ok",
      database: "ok",
      version: "dev",
    });
  });

  it("is 503 unavailable when the database is down, without leaking why", async () => {
    // A database that does not exist on the server: every query fails.
    const url = databaseUrl(t.database.url, "dwrg_tmp_does_not_exist");
    const down = createDb(url, { max: 1 });
    try {
      const env = testEnv(url);
      const app = createApp({
        db: down.db,
        auth: createAuth({ db: down.db, env }),
        env,
        logger: silentLogger,
      });
      const res = await app.request(`${API_ORIGIN}/health`);
      expect(res.status).toBe(503);
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({ status: "unavailable", database: "down", version: "dev" });
      expect(text).not.toContain("does_not_exist");
    } finally {
      await down.close();
    }
  });
});

describe("every response", () => {
  it("carries a request id, which is reused when the caller sends a sane one", async () => {
    const fresh = await t.app.request(`${API_ORIGIN}/health`);
    expect(fresh.headers.get("X-Request-Id")).toMatch(/^[0-9a-f-]{36}$/);

    const res = await t.app.request(`${API_ORIGIN}/health`, {
      headers: { "X-Request-Id": "trace-abc-123" },
    });
    expect(res.headers.get("X-Request-Id")).toBe("trace-abc-123");
    expect(t.logs.some((l) => l.requestId === "trace-abc-123" && l.msg === "request")).toBe(true);
  });

  it("has secure headers and is never cached", async () => {
    const res = await t.app.request(`${API_ORIGIN}/health`);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("allows the web app's origin with credentials, and no other origin", async () => {
    const preflight = (origin: string) =>
      t.app.request(`${API_ORIGIN}/api/me`, {
        method: "OPTIONS",
        headers: { Origin: origin, "Access-Control-Request-Method": "GET" },
      });
    const ok = await preflight(t.env.WEB_ORIGIN);
    expect(ok.headers.get("Access-Control-Allow-Origin")).toBe(t.env.WEB_ORIGIN);
    expect(ok.headers.get("Access-Control-Allow-Credentials")).toBe("true");

    const evil = await preflight("https://evil.example");
    expect(evil.headers.get("Access-Control-Allow-Origin")).not.toBe("https://evil.example");
  });

  it("answers unknown paths with the JSON error shape", async () => {
    const res = await t.app.request(`${API_ORIGIN}/nope`);
    expect(res.status).toBe(404);
    const error = await errorOf(res);
    expect(error.code).toBe("not_found");
    expect(error.requestId).toBe(res.headers.get("X-Request-Id"));
  });

  it("writes one structured JSON log line per request", async () => {
    const res = await t.app.request(`${API_ORIGIN}/nope`);
    const id = res.headers.get("X-Request-Id");
    const line = t.logs.find((l) => l.requestId === id && l.msg === "request");
    expect(line).toMatchObject({ level: "info", method: "GET", path: "/nope", status: 404 });
    expect(typeof line?.durationMs).toBe("number");
    expect(typeof line?.time).toBe("string");
  });
});
