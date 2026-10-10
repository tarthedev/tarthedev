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
