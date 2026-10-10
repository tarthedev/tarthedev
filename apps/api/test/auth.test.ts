import { session, user } from "@dwrg/db";
import { meResponseSchema } from "@dwrg/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { createAuth } from "../src/auth";
import { silentLogger } from "../src/logger";
import {
  API_ORIGIN,
  bodyAs,
  call,
  cookieHeader,
  createLogin,
  errorOf,
  loginAs,
  setupTestApp,
  signIn,
  signInRequest,
  type TestApp,
  testEnv,
  WEB_ORIGIN,
} from "./helpers";

let t: TestApp;
beforeAll(async () => {
  t = await setupTestApp();
});
afterAll(async () => {
  await t?.close();
});

describe("sign in with email and password, then GET /api/me", () => {
  it("returns the signed-in person, their staff row and the session expiry", async () => {
    const login = await createLogin(t, {
      role: "dispatcher_csr",
      name: "Casey Desk",
      email: "casey@test.dwrg.example",
      phone: "+12525550100",
    });

    const res = await t.app.request(signInRequest("Casey@Test.dwrg.example", login.password));
    expect(res.status).toBe(200);
    const setCookie = res.headers.getSetCookie().join("\n");
    expect(setCookie).toMatch(/dwrg\.session_token=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    // Not production, so not Secure (production uses __Secure- cookies).
    expect(setCookie).not.toMatch(/;\s*Secure/i);

    // The session token is only in the HttpOnly cookie, never in the body.
    const signInBody = (await res.json()) as Record<string, unknown>;
    expect(signInBody).not.toHaveProperty("token");
    expect(JSON.stringify(signInBody)).not.toContain(
      cookieHeader(res).split("=")[1]?.split(".")[0] ?? "nothing",
    );

    const me = await call(t, "/api/me", { cookie: cookieHeader(res) });
    expect(me.status).toBe(200);
    const body = await bodyAs(meResponseSchema, me);
    expect(body.user).toEqual({
      id: login.id,
      name: "Casey Desk",
      email: "casey@test.dwrg.example",
      role: "dispatcher_csr",
      image: null,
    });
    expect(body.employee).toMatchObject({ phone: "+12525550100", businessUnits: ["hvac_service"] });
    const expiresIn = Date.parse(body.session.expiresAt) - Date.now();
    expect(expiresIn).toBeGreaterThan(6 * 24 * 3600 * 1000);
    expect(expiresIn).toBeLessThanOrEqual(7 * 24 * 3600 * 1000);
  });

  it("get-session works for the web app but never shows the token", async () => {
    const { cookie } = await loginAs(t, { role: "manager" });
    const res = await call(t, "/api/auth/get-session", { cookie });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { session: Record<string, unknown>; user: { role: string } };
    expect(body.user.role).toBe("manager");
    expect(body.session).not.toHaveProperty("token");
  });

  it("list-sessions never shows tokens either", async () => {
    const { cookie } = await loginAs(t, { role: "manager" });
    const res = await call(t, "/api/auth/list-sessions", { cookie });
    expect(res.status).toBe(200);
    const sessions = (await res.json()) as Record<string, unknown>[];
    expect(sessions.length).toBeGreaterThan(0);
    for (const s of sessions) expect(s).not.toHaveProperty("token");
  });

  it("extends a session that is due for refresh and passes the new cookie on", async () => {
    const login = await createLogin(t, { role: "owner" });
    const cookie = await signIn(t, login.email, login.password);
    // Make the session look a day old: it expires in under 6 days.
    const soon = new Date(Date.now() + 5 * 24 * 3600 * 1000);
    await t.db.update(session).set({ expiresAt: soon }).where(eq(session.userId, login.id));

    const res = await call(t, "/api/me", { cookie });
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie().join("\n")).toMatch(/dwrg\.session_token=.+Max-Age=\d+/);
    const [row] = await t.db
      .select({ expiresAt: session.expiresAt })
      .from(session)
      .where(eq(session.userId, login.id));
    expect(row?.expiresAt.getTime()).toBeGreaterThan(soon.getTime() + 24 * 3600 * 1000);
  });

  it("gives /api/me without a login a 401 in the JSON error shape", async () => {
    const res = await call(t, "/api/me");
    expect(res.status).toBe(401);
    expect((await errorOf(res)).code).toBe("unauthorized");
  });

  it("refuses a forged or stale session cookie", async () => {
    const res = await call(t, "/api/me", { cookie: "dwrg.session_token=forged.value" });
    expect(res.status).toBe(401);
  });

  it("refuses a wrong password without saying which part was wrong", async () => {
    const login = await createLogin(t, { role: "tech" });
    const res = await t.app.request(signInRequest(login.email, "not-the-password"));
    expect(res.status).toBe(401);
    expect(res.headers.getSetCookie()).toEqual([]);
    const unknown = await t.app.request(signInRequest("nobody@test.dwrg.example", "whatever-123"));
    expect(unknown.status).toBe(401);
    expect(await unknown.json()).toEqual(await res.json());
  });

  it("signs out: the old cookie no longer works", async () => {
    const { cookie } = await loginAs(t, { role: "owner" });
    const out = await t.app.request(`${API_ORIGIN}/api/auth/sign-out`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: WEB_ORIGIN, "Content-Type": "application/json" },
      body: "{}",
    });
    expect(out.status).toBe(200);
    expect((await call(t, "/api/me", { cookie })).status).toBe(401);
  });
});

describe("no public sign-up", () => {
  it("refuses Better Auth's sign-up endpoint and creates no user", async () => {
    const res = await t.app.request(`${API_ORIGIN}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: WEB_ORIGIN },
      body: JSON.stringify({
        name: "Walk In",
        email: "walkin@test.dwrg.example",
        password: "a-long-enough-password",
      }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    const rows = await t.db.select().from(user).where(eq(user.email, "walkin@test.dwrg.example"));
    expect(rows).toEqual([]);
  });

  it("ignores attempts to set role or active through Better Auth", async () => {
    const { cookie, id } = await loginAs(t, { role: "tech" });
    await t.app.request(`${API_ORIGIN}/api/auth/update-user`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: WEB_ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ role: "owner", name: "Still A Tech" }),
    });
    const [row] = await t.db.select({ role: user.role }).from(user).where(eq(user.id, id));
    expect(row?.role).toBe("tech");
  });
});

describe("turned-off logins", () => {
  it("can't sign in", async () => {
    const login = await createLogin(t, { role: "tech", active: false });
    const res = await t.app.request(signInRequest(login.email, login.password));
    expect(res.status).toBe(403);
    expect(
      res.headers
        .getSetCookie()
        .filter((c) => c.includes("session_token=") && !c.includes("session_token=;")),
    ).toEqual([]);
  });

  it("lose access at once, even with a session from before", async () => {
    const login = await createLogin(t, { role: "tech" });
    const cookie = await signIn(t, login.email, login.password);
    expect((await call(t, "/api/me", { cookie })).status).toBe(200);
    await t.db.update(user).set({ active: false }).where(eq(user.id, login.id));
    const res = await call(t, "/api/me", { cookie });
    expect(res.status).toBe(401);
  });
});

describe("in production", () => {
  it("session cookies are Secure, HttpOnly and __Secure- prefixed", async () => {
    const origin = "https://app.example.com";
    const env = testEnv(t.database.url, {
      NODE_ENV: "production",
      BETTER_AUTH_SECRET: "p".repeat(64),
      BETTER_AUTH_URL: origin,
      WEB_ORIGIN: origin,
    });
    const app = createApp({
      db: t.db,
      auth: createAuth({ db: t.db, env, logger: silentLogger }),
      env,
      logger: silentLogger,
    });
    const login = await createLogin(t, { role: "manager" });
    const res = await app.request(`${origin}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ email: login.email, password: login.password }),
    });
    expect(res.status).toBe(200);
    const cookie = res.headers.getSetCookie().find((c) => c.includes("session_token="));
    expect(cookie).toMatch(/^__Secure-dwrg\.session_token=/);
    expect(cookie).toMatch(/;\s*Secure/i);
    expect(cookie).toMatch(/;\s*HttpOnly/i);

    const me = await app.request(`${origin}/api/me`, {
      headers: { Cookie: cookieHeader(res), Origin: origin },
    });
    expect(me.status).toBe(200);
  });
});
