import { account, auditLog, user } from "@dwrg/db";
import { DEMO_EMAIL_DOMAIN } from "@dwrg/db/demo";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_LOGINS_REASON, DEMO_PASSWORD, seedDemoLogins } from "../src/services/demo-logins";
import { call, createLogin, setupTestApp, signIn, type TestApp } from "./helpers";

let t: TestApp;

beforeAll(async () => {
  t = await setupTestApp();
  // Demo users as `pnpm db:seed` leaves them: user rows, no credentials.
  await t.db.insert(user).values([
    { id: "demo-owner", name: "Demo Owner", email: `owner@${DEMO_EMAIL_DOMAIN}`, role: "owner" },
    { id: "demo-tech", name: "Demo Tech", email: `tech@${DEMO_EMAIL_DOMAIN}`, role: "tech" },
  ]);
});
afterAll(async () => {
  await t?.close();
});

describe("seed-auth (seedDemoLogins)", () => {
  it("gives every demo user a login that Better Auth accepts", async () => {
    const outsider = await createLogin(t, { role: "manager", password: "outsider-password" });
    const logins = await seedDemoLogins(t.db, t.auth, { emailDomain: DEMO_EMAIL_DOMAIN });
    expect(logins.map((l) => [l.email, l.role, l.result])).toEqual([
      [`owner@${DEMO_EMAIL_DOMAIN}`, "owner", "created"],
      [`tech@${DEMO_EMAIL_DOMAIN}`, "tech", "created"],
    ]);

    const cookie = await signIn(t, `owner@${DEMO_EMAIL_DOMAIN}`, DEMO_PASSWORD);
    const me = await call(t, "/api/me", { cookie });
    expect(me.status).toBe(200);

    // Only demo users are touched.
    await signIn(t, outsider.email, "outsider-password");

    const audits = await t.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.tableName, "account"), eq(auditLog.reason, DEMO_LOGINS_REASON)));
    expect(audits).toHaveLength(2);
    expect(JSON.stringify(audits)).not.toMatch(/scrypt|demo-password/);
    expect(audits.every((a) => (a.after as { password: string }).password === "[redacted]")).toBe(
      true,
    );
  });

  it("is idempotent: a second run changes nothing", async () => {
    const before = await t.db.select().from(account);
    const logins = await seedDemoLogins(t.db, t.auth, { emailDomain: DEMO_EMAIL_DOMAIN });
    expect(logins.map((l) => l.result)).toEqual(["unchanged", "unchanged"]);
    expect(await t.db.select().from(account)).toEqual(before);
  });

  it("resets a demo password that was changed", async () => {
    await t.db
      .update(account)
      .set({ password: "not-a-valid-hash" })
      .where(eq(account.userId, "demo-tech"));
    const logins = await seedDemoLogins(t.db, t.auth, { emailDomain: DEMO_EMAIL_DOMAIN });
    expect(logins.find((l) => l.userId === "demo-tech")?.result).toBe("updated");
    await signIn(t, `tech@${DEMO_EMAIL_DOMAIN}`, DEMO_PASSWORD);
  });

  it("refuses a pattern that isn't an email domain", async () => {
    for (const emailDomain of ["%", "", "demo.dwrg.example' or '1'='1"]) {
      await expect(seedDemoLogins(t.db, t.auth, { emailDomain })).rejects.toThrow(
        /Not an email domain/,
      );
    }
  });
});
