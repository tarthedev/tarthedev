import { account, auditLog, employees, user } from "@dwrg/db";
import {
  type CreateEmployeeRequest,
  employeeListResponseSchema,
  employeeSchema,
} from "@dwrg/shared";
import { and, asc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bodyAs, call, errorOf, loginAs, setupTestApp, signIn, type TestApp } from "./helpers";

let t: TestApp;
let owner: Awaited<ReturnType<typeof loginAs>>;
let manager: Awaited<ReturnType<typeof loginAs>>;

beforeAll(async () => {
  t = await setupTestApp();
  owner = await loginAs(t, { role: "owner", name: "Olive Owner" });
  manager = await loginAs(t, { role: "manager", name: "Mona Manager" });
});
afterAll(async () => {
  await t?.close();
});

const request: CreateEmployeeRequest = {
  name: "  Terry Tech ",
  email: " Terry.Tech@Test.DWRG.example ",
  role: "tech",
  password: "new-tech-password-1",
  phone: "(252) 555-0142",
  skills: ["hvac", "plumbing", "hvac"],
  businessUnits: ["hvac_service"],
  hiredOn: "2026-10-05",
  reason: "Hired for the pilot crew",
};

describe("POST /api/employees", () => {
  let created: ReturnType<typeof employeeSchema.parse>;

  it("creates the login and staff row, normalized", async () => {
    const res = await call(t, "/api/employees", { cookie: manager.cookie, json: request });
    expect(res.status).toBe(201);
    created = await bodyAs(employeeSchema, res);
    expect(created).toMatchObject({
      name: "Terry Tech",
      email: "terry.tech@test.dwrg.example",
      role: "tech",
      active: true,
      hasPassword: true,
      phone: "+12525550142",
      skills: ["hvac", "plumbing"],
      businessUnits: ["hvac_service"],
      hiredOn: "2026-10-05",
      stId: null,
    });
    expect(JSON.stringify(created)).not.toContain("password-1");
  });

  it("writes audit rows with who, when, before, after and the reason, never the hash", async () => {
    const rows = await t.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.userId, manager.id))
      .orderBy(asc(auditLog.id));
    expect(rows.map((r) => [r.tableName, r.action])).toEqual([
      ["user", "insert"],
      ["account", "insert"],
      ["employees", "insert"],
    ]);
    for (const row of rows) {
      expect(row.reason).toBe("Hired for the pilot crew");
      expect(row.before).toBeNull();
      expect(row.at).toBeInstanceOf(Date);
      expect(Date.now() - row.at.getTime()).toBeLessThan(60_000);
    }
    const [userRow, accountRow, employeeRow] = rows;
    expect(userRow?.rowId).toBe(created.userId);
    expect(userRow?.after).toMatchObject({ email: "terry.tech@test.dwrg.example", role: "tech" });
    expect(employeeRow?.rowId).toBe(created.employeeId);
    expect(employeeRow?.after).toMatchObject({ userId: created.userId, createdBy: manager.id });
    expect(accountRow?.after).toMatchObject({ providerId: "credential", password: "[redacted]" });

    // The real hash is in the account table only.
    const [stored] = await t.db
      .select({ password: account.password })
      .from(account)
      .where(eq(account.userId, created.userId));
    expect(stored?.password).toMatch(/\S{20,}/);
    expect(JSON.stringify(rows)).not.toContain(stored?.password ?? "nothing");
  });

  it("gives a login that works with the chosen password", async () => {
    const cookie = await signIn(t, "terry.tech@test.dwrg.example", "new-tech-password-1");
    const me = await call(t, "/api/me", { cookie });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { user: { role: string } }).user.role).toBe("tech");
  });

  it("refuses an email that is already used (any case), changing nothing", async () => {
    const before = await t.db.select().from(auditLog);
    const res = await call(t, "/api/employees", {
      cookie: owner.cookie,
      json: { ...request, email: "TERRY.TECH@test.dwrg.example" },
    });
    expect(res.status).toBe(409);
    const error = await errorOf(res);
    expect(error).toMatchObject({
      code: "conflict",
      fields: { email: ["A login with this email already exists"] },
    });
    expect(await t.db.select().from(auditLog)).toHaveLength(before.length);
    const users = await t.db
      .select()
      .from(user)
      .where(eq(user.email, "terry.tech@test.dwrg.example"));
    expect(users).toHaveLength(1);
  });

  it("records a default reason when none is given", async () => {
    const res = await call(t, "/api/employees", {
      cookie: owner.cookie,
      json: {
        name: "Ivy Installer",
        email: "ivy@test.dwrg.example",
        role: "installer",
        password: "installer-password",
      },
    });
    expect(res.status).toBe(201);
    const body = await bodyAs(employeeSchema, res);
    expect(body).toMatchObject({ phone: null, skills: [], businessUnits: [], hiredOn: null });
    const rows = await t.db
      .select({ reason: auditLog.reason, userId: auditLog.userId })
      .from(auditLog)
      .where(and(eq(auditLog.rowId, body.userId), eq(auditLog.tableName, "user")));
    expect(rows).toEqual([{ reason: "New Installer login", userId: owner.id }]);
  });

  it("rolls back the login and its audit rows when a later step fails, leaking nothing", async () => {
    // Make the last write (the employees row) fail in this throwaway database,
    // after the user, account and their audit rows were written.
    await t.database.sql.unsafe(`
      create function test_fail_employee() returns trigger language plpgsql as $$
      begin
        if new.phone = '+12525550666' then raise exception 'secret internal detail'; end if;
        return new;
      end $$;
      create trigger test_fail_employee before insert on employees
        for each row execute function test_fail_employee();
    `);
    const auditBefore = await t.db.select().from(auditLog);
    const res = await call(t, "/api/employees", {
      cookie: owner.cookie,
      json: { ...request, email: "rollback@test.dwrg.example", phone: "252-555-0666" },
    });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toMatch(/secret internal detail|employees|insert/i);
    expect(JSON.parse(text)).toMatchObject({ error: { code: "internal" } });

    const users = await t.db
      .select()
      .from(user)
      .where(eq(user.email, "rollback@test.dwrg.example"));
    expect(users).toEqual([]);
    expect(await t.db.select().from(auditLog)).toHaveLength(auditBefore.length);
    const id = res.headers.get("X-Request-Id");
    const logged = t.logs.find((l) => l.requestId === id && l.msg === "unhandled error");
    expect(JSON.stringify(logged)).toContain("secret internal detail");
  });
});

describe("GET /api/employees", () => {
  it("lists every login with its staff details and no pay or secrets", async () => {
    const res = await call(t, "/api/employees", { cookie: owner.cookie });
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = employeeListResponseSchema.parse(JSON.parse(text));
    expect(body.items.map((e) => e.name)).toEqual([
      "Ivy Installer",
      "Mona Manager",
      "Olive Owner",
      "Terry Tech",
    ]);
    for (const item of body.items)
      expect(Object.keys(item).sort()).toEqual(Object.keys(employeeSchema.shape).sort());
    expect(text).not.toMatch(/scrypt|"password"|wage|burden/i);
  });

  it("filters by role and by active", async () => {
    const techs = await call(t, "/api/employees?role=tech", { cookie: owner.cookie });
    expect((await bodyAs(employeeListResponseSchema, techs)).items.map((e) => e.email)).toEqual([
      "terry.tech@test.dwrg.example",
    ]);

    const ivy = await t.db.select().from(user).where(eq(user.email, "ivy@test.dwrg.example"));
    await t.db
      .update(user)
      .set({ active: false })
      .where(
        inArray(
          user.id,
          ivy.map((u) => u.id),
        ),
      );
    const off = await call(t, "/api/employees?active=false", { cookie: owner.cookie });
    expect((await bodyAs(employeeListResponseSchema, off)).items.map((e) => e.name)).toEqual([
      "Ivy Installer",
    ]);
    const on = await call(t, "/api/employees?active=true", { cookie: owner.cookie });
    expect((await bodyAs(employeeListResponseSchema, on)).items).toHaveLength(3);
  });

  it("shows logins without a staff row", async () => {
    const bare = await loginAs(t, { role: "dispatcher_csr", name: "Bare Login", employee: false });
    const res = await call(t, "/api/employees?role=dispatcher_csr", { cookie: owner.cookie });
    const [item] = (await bodyAs(employeeListResponseSchema, res)).items;
    expect(item).toMatchObject({
      userId: bare.id,
      employeeId: null,
      skills: [],
      hasPassword: true,
    });
    const staff = await t.db.select().from(employees).where(eq(employees.userId, bare.id));
    expect(staff).toEqual([]);
  });
});
