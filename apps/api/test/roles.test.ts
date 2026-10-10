import { ROLES, type Role } from "@dwrg/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, errorOf, loginAs, setupTestApp, type TestApp } from "./helpers";

let t: TestApp;
const cookies = {} as Record<Role, string>;

beforeAll(async () => {
  t = await setupTestApp();
  for (const role of ROLES) cookies[role] = (await loginAs(t, { role })).cookie;
});
afterAll(async () => {
  await t?.close();
});

const newLogin = (role: Role, n: number) => ({
  name: `New ${role} ${n}`,
  email: `new.${role}.${n}@test.dwrg.example`,
  role,
  password: "a-long-enough-password",
  reason: "Role test",
});

/** Who may call what (docs/03-tech-stack.md, Security; office roles only for now). */
const ACCESS: { path: string; allowed: readonly Role[] }[] = [
  { path: "/api/me", allowed: ROLES },
  { path: "/api/customers", allowed: ["owner", "manager", "dispatcher_csr"] },
  { path: "/api/pricebook", allowed: ["owner", "manager", "dispatcher_csr"] },
  { path: "/api/employees", allowed: ["owner", "manager"] },
];

describe("role enforcement", () => {
  for (const { path, allowed } of ACCESS) {
    for (const role of ROLES) {
      const ok = allowed.includes(role);
      it(`${role} ${ok ? "can" : "can't"} GET ${path}`, async () => {
        const res = await call(t, path, { cookie: cookies[role] });
        expect(res.status).toBe(ok ? 200 : 403);
        if (!ok) {
          const error = await errorOf(res);
          expect(error.code).toBe("forbidden");
        }
      });
    }
  }

  it("a tech gets 403 on GET /api/employees, and the denial is logged", async () => {
    const res = await call(t, "/api/employees", { cookie: cookies.tech });
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toMatchObject({
      code: "forbidden",
      message: "Tech logins can't use this.",
    });
    const id = res.headers.get("X-Request-Id");
    expect(t.logs.some((l) => l.requestId === id && l.msg === "role denied")).toBe(true);
  });

  it("a tech can't reach a customer file by id either", async () => {
    const res = await call(t, "/api/customers/00000000-0000-4000-8000-000000000000", {
      cookie: cookies.tech,
    });
    expect(res.status).toBe(403);
  });

  it("only owners and managers create logins", async () => {
    for (const role of ["dispatcher_csr", "tech", "installer"] as const) {
      const res = await call(t, "/api/employees", {
        cookie: cookies[role],
        json: newLogin("tech", 1),
      });
      expect(res.status).toBe(403);
    }
    const res = await call(t, "/api/employees", {
      cookie: cookies.manager,
      json: newLogin("tech", 2),
    });
    expect(res.status).toBe(201);
  });

  it("a manager can't create an owner; an owner can", async () => {
    const byManager = await call(t, "/api/employees", {
      cookie: cookies.manager,
      json: newLogin("owner", 3),
    });
    expect(byManager.status).toBe(403);
    expect((await errorOf(byManager)).fields).toEqual({
      role: ["You can't create Owner logins"],
    });

    const byOwner = await call(t, "/api/employees", {
      cookie: cookies.owner,
      json: newLogin("owner", 4),
    });
    expect(byOwner.status).toBe(201);
  });

  it("checks the session before the role: no login is 401, not 403", async () => {
    const res = await call(t, "/api/employees");
    expect(res.status).toBe(401);
  });
});

/**
 * Every route the app serves, with who may call it. A route that isn't listed
 * here fails this test, so no endpoint ships without a stated role check
 * (docs/04 "Foundation first": role checks on every endpoint).
 */
const OFFICE: readonly Role[] = ["owner", "manager", "dispatcher_csr"];
const ROUTE_ROLES: Record<string, readonly Role[] | "public"> = {
  "GET /health": "public",
  // Better Auth: only the allow-listed endpoints answer (auth.test.ts).
  "GET /api/auth/*": "public",
  "POST /api/auth/*": "public",
  "GET /api/me": ROLES,
  "GET /api/customers": OFFICE,
  "GET /api/customers/:id": OFFICE,
  "GET /api/employees": ["owner", "manager"],
  "POST /api/employees": ["owner", "manager"],
  "GET /api/imports": OFFICE,
  "POST /api/imports/preview": OFFICE,
  "POST /api/imports": OFFICE,
  "GET /api/imports/:id": OFFICE,
  "POST /api/imports/:id/summary": OFFICE,
  "GET /api/pricebook": OFFICE,
};

const SOME_ID = "00000000-0000-4000-8000-000000000000";

describe("every endpoint states its roles", () => {
  it("the route table matches the app's routes exactly", () => {
    const served = new Set(
      t.app.routes.filter((r) => r.method !== "ALL").map((r) => `${r.method} ${r.path}`),
    );
    expect([...served].sort()).toEqual(Object.keys(ROUTE_ROLES).sort());
  });

  for (const [route, allowed] of Object.entries(ROUTE_ROLES)) {
    if (allowed === "public") continue;
    const [method = "GET", pattern = ""] = route.split(" ");
    const path = pattern.replace(":id", SOME_ID);
    const json = method === "GET" ? undefined : {};

    it(`${route} needs a login`, async () => {
      const res = await call(t, path, { method, json });
      expect(res.status).toBe(401);
    });

    for (const role of ROLES) {
      const ok = allowed.includes(role);
      it(`${route}: ${role} ${ok ? "gets past the role check" : "gets 403"}`, async () => {
        const res = await call(t, path, { method, json, cookie: cookies[role] });
        if (ok) expect([401, 403]).not.toContain(res.status);
        else expect(res.status).toBe(403);
      });
    }
  }
});
