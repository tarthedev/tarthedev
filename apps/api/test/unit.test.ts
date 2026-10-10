import * as db from "@dwrg/db";
import * as shared from "@dwrg/shared";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { withoutSessionTokens } from "../src/auth";
import type { AppEnv, AuthedEnv } from "../src/context";
import { InvalidEnvError, parseEnv } from "../src/env";
import { handleError } from "../src/errors";
import { createLogger, silentLogger } from "../src/logger";
import { auditContext, requireRole } from "../src/middleware/session";
import { containsPattern, escapeLike, phoneDigits, searchWords } from "../src/services/search";

/** Fast tests that need no database. */

const base = {
  DATABASE_URL: "postgres://u:p@localhost:5432/x",
  BETTER_AUTH_SECRET: "dev-secret",
  BETTER_AUTH_URL: "http://localhost:8787/",
  WEB_ORIGIN: "http://localhost:5173",
};

describe("parseEnv", () => {
  it("fills defaults and normalizes origins", () => {
    const env = parseEnv(base);
    expect(env).toMatchObject({
      NODE_ENV: "development",
      PORT: 8787,
      HOST: "0.0.0.0",
      APP_VERSION: "dev",
      DWRG_ENV: "local",
      LOG_LEVEL: "info",
      BETTER_AUTH_URL: "http://localhost:8787",
    });
  });

  it("lists every missing setting at once", () => {
    expect(() => parseEnv({})).toThrow(InvalidEnvError);
    try {
      parseEnv({});
    } catch (error) {
      const problems = (error as InvalidEnvError).problems.join("\n");
      for (const key of ["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "WEB_ORIGIN"]) {
        expect(problems).toContain(key);
      }
    }
  });

  it("insists on a real secret and https in production", () => {
    expect(() => parseEnv({ ...base, NODE_ENV: "production" })).toThrow(
      /BETTER_AUTH_SECRET.*\n.*BETTER_AUTH_URL: Must be https in production\n.*WEB_ORIGIN/s,
    );
    const env = parseEnv({
      ...base,
      NODE_ENV: "production",
      BETTER_AUTH_SECRET: "a".repeat(64),
      BETTER_AUTH_URL: "https://app.example.com",
      WEB_ORIGIN: "https://app.example.com",
    });
    expect(env.NODE_ENV).toBe("production");
  });
});

describe("logger", () => {
  it("writes one JSON object per line with bindings, and redacts secrets", () => {
    const lines: string[] = [];
    const log = createLogger({
      write: (l) => lines.push(l),
      now: () => new Date("2026-10-09T12:00:00Z"),
      base: { service: "api" },
    }).child({ requestId: "r1" });
    log.info("hello", {
      password: "hunter2hunter2",
      headers: { cookie: "dwrg.session_token=abc", authorization: "Bearer x" },
      sessionToken: "abc",
      err: new Error("boom"),
      count: 3n,
    });
    log.debug("hidden at info level");
    expect(lines).toHaveLength(1);
    const line = JSON.parse(lines[0] ?? "{}");
    expect(line).toMatchObject({
      time: "2026-10-09T12:00:00.000Z",
      level: "info",
      msg: "hello",
      service: "api",
      requestId: "r1",
      password: "[redacted]",
      headers: { cookie: "[redacted]", authorization: "[redacted]" },
      sessionToken: "[redacted]",
      err: { name: "Error", message: "boom" },
      count: "3",
    });
    expect(lines[0]).not.toContain("hunter2");
  });
});

describe("value lists in @dwrg/shared match the database's CHECK lists", () => {
  const pairs: [string, readonly string[], readonly string[]][] = [
    ["ROLES", shared.ROLES, db.ROLES],
    ["SKILLS", shared.SKILLS, db.SKILLS],
    ["BUSINESS_UNIT_CODES", shared.BUSINESS_UNIT_CODES, db.BUSINESS_UNIT_CODES],
    ["CUSTOMER_TYPES", shared.CUSTOMER_TYPES, db.CUSTOMER_TYPES],
    ["EQUIPMENT_KINDS", shared.EQUIPMENT_KINDS, db.EQUIPMENT_KINDS],
    ["MEMBERSHIP_STATUSES", shared.MEMBERSHIP_STATUSES, db.MEMBERSHIP_STATUSES],
    ["PRICEBOOK_KINDS", shared.PRICEBOOK_KINDS, db.PRICEBOOK_KINDS],
    ["ORIGINS", shared.ORIGINS, db.ORIGINS],
    ["INVOICE_STATUSES", shared.INVOICE_STATUSES, db.INVOICE_STATUSES],
    ["BILLING_STAGES", shared.BILLING_STAGES, db.BILLING_STAGES],
  ];
  it.each(pairs)("%s", (_name, ours, database) => {
    expect(ours).toEqual(database);
  });
});

describe("search helpers", () => {
  it("escapes LIKE wildcards", () => {
    expect(escapeLike("100%_\\")).toBe("100\\%\\_\\\\");
    expect(containsPattern("a%")).toBe("%a\\%%");
  });

  it("recognizes phone-like queries", () => {
    expect(phoneDigits("(252) 555-0123")).toBe("2525550123");
    expect(phoneDigits("+1 252.555.0123")).toBe("12525550123");
    expect(phoneDigits("123")).toBeUndefined();
    expect(phoneDigits("Main 1234")).toBeUndefined();
  });

  it("uses at most six words", () => {
    expect(searchWords("a b c d e f g h")).toEqual(["a", "b", "c", "d", "e", "f"]);
  });
});

describe("withoutSessionTokens", () => {
  it("drops token and session.token from JSON bodies and keeps cookies", async () => {
    const headers = new Headers({ "Content-Type": "application/json" });
    headers.append("Set-Cookie", "a=1; HttpOnly");
    headers.append("Set-Cookie", "b=2; HttpOnly");
    const res = await withoutSessionTokens(
      new Response(JSON.stringify({ token: "t1", session: { id: "s", token: "t2" }, user: {} }), {
        status: 200,
        headers,
      }),
    );
    expect(await res.json()).toEqual({ session: { id: "s" }, user: {} });
    expect(res.headers.getSetCookie()).toEqual(["a=1; HttpOnly", "b=2; HttpOnly"]);
  });

  it("drops the token from every session in a list", async () => {
    const res = await withoutSessionTokens(
      Response.json([
        { id: "s1", token: "t1" },
        { id: "s2", token: "t2" },
      ]),
    );
    expect(await res.json()).toEqual([{ id: "s1" }, { id: "s2" }]);
  });

  it("leaves other responses alone", async () => {
    const res = await withoutSessionTokens(
      new Response("null", { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    expect(await res.text()).toBe("null");
    const redirect = new Response(null, { status: 302, headers: { Location: "/x" } });
    expect(await withoutSessionTokens(redirect)).toBe(redirect);
  });
});

describe("middleware guards", () => {
  it("requireRole needs at least one role", () => {
    expect(() => requireRole()).toThrow(/at least one role/);
  });

  it("an audited change must have a reason", async () => {
    // Shaped like createApp: an AppEnv app with the error handler, and an
    // authed router (here with a stand-in for requireSession).
    const authed = new Hono<AuthedEnv>();
    authed.use("*", async (c, next) => {
      c.set("user", { id: "u1", name: "U", email: "u@x.example", role: "owner", image: null });
      await next();
    });
    authed.use("*", auditContext());
    authed.get("/ok", (c) => c.json(c.get("audit").ctx("  Fixing a typo ")));
    authed.get("/blank", (c) => c.json(c.get("audit").ctx("   ")));

    const app = new Hono<AppEnv>();
    app.use("*", async (c, next) => {
      c.set("requestId", "r1");
      c.set("log", silentLogger);
      await next();
    });
    app.route("/", authed);
    app.onError(handleError);

    const ok = await app.request("/ok");
    expect(await ok.json()).toEqual({ userId: "u1", reason: "Fixing a typo" });
    const blank = await app.request("/blank");
    expect(blank.status).toBe(500);
    expect(await blank.json()).toMatchObject({ error: { code: "internal", requestId: "r1" } });
  });
});
