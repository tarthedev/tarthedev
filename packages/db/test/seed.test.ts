import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { customers } from "../src/schema";
import {
  DEMO_END_DATE,
  DEMO_TABLE_ORDER,
  type DemoData,
  DemoSeedRefusedError,
  generateDemoData,
  ladderLevel,
  localDay,
  PILOT_CREW_SETTING_KEY,
  type PilotCrewSetting,
  seedDemoData,
  summarizeDemoData,
} from "../src/seed";
import { createTestDatabase, type TestDatabase } from "../src/testing";

const ST_TABLES = [
  "businessUnits",
  "employees",
  "pricebookItems",
  "membershipPlans",
  "customers",
  "locations",
  "contacts",
  "equipment",
  "memberships",
  "jobs",
  "appointments",
  "assignments",
  "timeEntries",
  "invoices",
  "invoiceLines",
  "payments",
  "jobCosts",
] as const;

/** Every *Cents / *Bps value in every row. */
function moneyValues(data: DemoData): [string, unknown][] {
  const out: [string, unknown][] = [];
  for (const name of DEMO_TABLE_ORDER) {
    for (const row of data[name]) {
      for (const [key, value] of Object.entries(row)) {
        if (/(Cents|Bps|CentsPerHour)$/.test(key) && value !== null && value !== undefined) {
          out.push([`${name}.${key}`, value]);
        }
      }
    }
  }
  return out;
}

describe("demo data generator", () => {
  const data = generateDemoData();
  const summary = summarizeDemoData(data);

  it("is deterministic: same seed, same rows, counts and totals", () => {
    const again = summarizeDemoData(generateDemoData());
    expect(again.counts).toEqual(summary.counts);
    expect(again.totals).toEqual(summary.totals);
    expect(again.fingerprint).toBe(summary.fingerprint);
    expect(generateDemoData(12345).users).toEqual(generateDemoData({ seed: 12345 }).users);
  });

  it("changes with the seed", () => {
    expect(summarizeDemoData(generateDemoData(7)).fingerprint).not.toBe(summary.fingerprint);
  });

  it("has the requested people, units, pricebook and customers", () => {
    expect(data.businessUnits.map((b) => b.code).sort()).toEqual([
      "commercial",
      "hvac_replacement",
      "hvac_service",
      "new_construction",
      "plumbing",
    ]);
    const roles = data.users.map((u) => u.role);
    expect(roles.filter((r) => r === "owner")).toHaveLength(1);
    expect(roles.filter((r) => r === "manager")).toHaveLength(1);
    expect(roles.filter((r) => r === "dispatcher_csr")).toHaveLength(1);
    expect(roles.filter((r) => r === "tech")).toHaveLength(8);
    expect(roles.filter((r) => r === "installer")).toHaveLength(2);
    for (const u of data.users) {
      expect(data.employees.filter((e) => e.userId === u.id)).toHaveLength(1);
      const rates = data.payRates.filter((r) => r.userId === u.id);
      expect(rates.length).toBeGreaterThan(0);
      for (const r of rates) {
        expect(r.wageCentsPerHour).toBeGreaterThanOrEqual(1800);
        expect(r.wageCentsPerHour).toBeLessThanOrEqual(2400);
        expect(r.burdenBps).toBe(13_000);
      }
    }

    const pilot = data.settings.find((s) => s.key === PILOT_CREW_SETTING_KEY)
      ?.value as PilotCrewSetting;
    expect(pilot.techUserIds).toHaveLength(2);
    for (const id of pilot.techUserIds)
      expect(data.users.find((u) => u.id === id)?.role).toBe("tech");
    expect(pilot.csrUserIds).toHaveLength(1);

    expect(data.pricebookItems.length).toBeGreaterThanOrEqual(55);
    expect(data.pricebookItems.length).toBeLessThanOrEqual(70);
    const tags = new Set(data.pricebookItems.flatMap((p) => p.comboTags ?? []));
    for (const tag of [
      "uv_light",
      "air_purifier",
      "dehumidifier",
      "surge_protector",
      "water_filter_or_softener",
      "leak_shutoff",
      "membership",
    ]) {
      expect(tags).toContain(tag);
    }
    const membership = data.pricebookItems.find((p) => p.comboTags?.includes("membership"));
    expect(membership?.priceCents).toBe(19_900);
    expect(data.membershipPlans[0]?.priceCents).toBe(19_900);

    expect(data.customers).toHaveLength(300);
    const commercial = data.customers.filter((c) => c.type === "commercial");
    expect(commercial.length).toBeGreaterThan(20);
    const sites = new Map<string, number>();
    for (const l of data.locations) sites.set(l.customerId, (sites.get(l.customerId) ?? 0) + 1);
    expect(commercial.some((c) => (sites.get(c.id) ?? 0) >= 3)).toBe(true);
    for (const l of data.locations) {
      expect(["Elizabeth City", "Camden", "Hertford", "Moyock"]).toContain(l.city);
      expect(Math.abs((l.lat ?? 0) - 36.29)).toBeLessThan(0.4);
      expect(Math.abs((l.lng ?? 0) + 76.22)).toBeLessThan(0.4);
    }
    expect(data.equipment.every((e) => e.installYear && e.installYear <= 2026)).toBe(true);
    expect(summary.membershipShareBps).toBeGreaterThanOrEqual(2500);
    expect(summary.membershipShareBps).toBeLessThanOrEqual(3500);
  });

  it("gives every row a unique DEMO- st_id", () => {
    for (const name of ST_TABLES) {
      const ids = data[name].map((row) => row.stId);
      expect(
        ids.every((id) => typeof id === "string" && id.startsWith("DEMO-")),
        name,
      ).toBe(true);
      expect(new Set(ids).size, name).toBe(ids.length);
    }
  });

  it("covers 12 months of history ending 2026-10-04", () => {
    const finished = data.jobs
      .flatMap((j) => (j.finishedAt ? [localDay(j.finishedAt)] : []))
      .sort();
    const first = finished[0] ?? "";
    const last = finished.at(-1) ?? "";
    expect(first >= "2025-10-06" && first <= "2025-10-10").toBe(true);
    expect(last >= "2026-10-01" && last <= DEMO_END_DATE).toBe(true);
    expect(data.invoices.every((i) => i.invoiceDate <= DEMO_END_DATE)).toBe(true);
    expect(data.payments.every((p) => localDay(p.receivedAt) <= DEMO_END_DATE)).toBe(true);
    expect(data.jobs.every((j) => j.origin === "servicetitan")).toBe(true);
  });

  it("keeps money in integer cents with consistent invoices and balances", () => {
    for (const [field, value] of moneyValues(data)) {
      expect(Number.isSafeInteger(value), `${field} = ${String(value)}`).toBe(true);
    }
    const linesBy = new Map<string, DemoData["invoiceLines"]>();
    for (const line of data.invoiceLines) {
      const list = linesBy.get(line.invoiceId) ?? [];
      list.push(line);
      linesBy.set(line.invoiceId, list);
    }
    const paidBy = new Map<string, number>();
    for (const p of data.payments)
      paidBy.set(p.invoiceId, (paidBy.get(p.invoiceId) ?? 0) + p.amountCents);
    for (const inv of data.invoices) {
      const lines = linesBy.get(inv.id) ?? [];
      let gross = 0;
      let discount = 0;
      let tax = 0;
      for (const line of lines) {
        const qty = Number.parseInt(line.quantity ?? "1", 10);
        expect(line.quantity).toMatch(/^\d+\.000$/);
        expect(line.amountCents).toBe(qty * line.unitPriceCents - (line.discountCents ?? 0));
        gross += qty * line.unitPriceCents;
        discount += line.discountCents ?? 0;
        tax += line.taxCents ?? 0;
      }
      expect(inv.subtotalCents).toBe(gross);
      expect(inv.discountCents).toBe(discount);
      expect(inv.taxCents).toBe(tax);
      expect(inv.totalCents).toBe(gross - discount + tax);
      expect(inv.balanceCents).toBe((inv.totalCents ?? 0) - (paidBy.get(inv.id) ?? 0));
      expect(inv.status).toBe(inv.balanceCents === 0 ? "paid" : "open");
      if (inv.status === "paid") expect(inv.paidInFullAt).toBeInstanceOf(Date);
    }
    expect(summary.openInvoices).toBeGreaterThan(20);
    expect(summary.openInvoices).toBeLessThan(data.invoices.length / 10);
  });

  it("lands average service tickets around $700 to $1,000", () => {
    expect(summary.averageServiceTicketCents).toBeGreaterThanOrEqual(70_000);
    expect(summary.averageServiceTicketCents).toBeLessThanOrEqual(100_000);
  });

  it("spreads weekly tech GP across every ladder level", () => {
    const weeks = Object.values(summary.ladderWeeks).reduce((a, b) => a + b, 0);
    expect(weeks).toBeGreaterThan(300);
    for (const [level, n] of Object.entries(summary.ladderWeeks)) {
      expect(n / weeks, level).toBeGreaterThanOrEqual(0.05);
    }
    expect(ladderLevel(449_999)).toBe("bronze");
    expect(ladderLevel(450_000)).toBe("silver");
  });

  it("includes the cases the pay engine needs", () => {
    expect(data.jobs.some((j) => j.callbackOfJobId && j.callbackTechCaused === true)).toBe(true);
    expect(data.jobs.some((j) => j.callbackOfJobId && j.callbackTechCaused === false)).toBe(true);
    const techs = new Set(data.users.filter((u) => u.role === "tech").map((u) => u.id));
    expect(data.jobs.some((j) => j.soldByUserId && techs.has(j.soldByUserId))).toBe(true);
    expect(data.jobs.some((j) => j.leadSourceUserId)).toBe(true);
    expect(data.invoices.some((i) => i.billingStage === "rough_in")).toBe(true);
    expect(data.payments.some((p) => p.method === "greensky")).toBe(true);
    expect(data.jobCosts.some((c) => c.kind === "card_fee")).toBe(true);
    expect(data.jobCosts.some((c) => c.kind === "labor")).toBe(true);
    const multiTech = new Map<string, Set<string>>();
    for (const t of data.timeEntries) {
      if (t.kind !== "job" || !t.jobId || !techs.has(t.userId)) continue;
      const set = multiTech.get(t.jobId) ?? new Set<string>();
      set.add(t.userId);
      multiTech.set(t.jobId, set);
    }
    expect([...multiTech.values()].some((s) => s.size === 2)).toBe(true);
    expect(data.payRates.some((r) => r.effectiveTo)).toBe(true);
  });
});

describe("seedDemoData", () => {
  let t: TestDatabase;
  beforeAll(async () => {
    t = await createTestDatabase();
  });
  afterAll(async () => {
    await t?.close();
  });

  const dbCounts = async () => {
    const rows = await t.db.execute<{ table: string; n: number }>(sql`
      select 'customers' as table, count(*)::int as n from customers
      union all select 'jobs', count(*)::int from jobs
      union all select 'invoices', count(*)::int from invoices
      union all select 'invoiceLines', count(*)::int from invoice_lines
      union all select 'payments', count(*)::int from payments
      union all select 'jobCosts', count(*)::int from job_costs
      union all select 'timeEntries', count(*)::int from time_entries
      union all select 'users', count(*)::int from "user"
    `);
    return Object.fromEntries(rows.map((r) => [r.table, r.n]));
  };
  const dbTotal = async () => {
    const [row] = await t.db.execute<{ total: string }>(
      sql`select coalesce(sum(total_cents), 0)::text as total from invoices`,
    );
    return Number(row?.total);
  };

  it("loads the full demo set, matching the generated counts and totals", async () => {
    const data = generateDemoData();
    const { summary } = await seedDemoData(t.db, data);
    const counts = await dbCounts();
    for (const name of [
      "customers",
      "jobs",
      "invoices",
      "invoiceLines",
      "payments",
      "jobCosts",
      "timeEntries",
      "users",
    ] as const) {
      expect(counts[name], name).toBe(summary.counts[name]);
    }
    expect(await dbTotal()).toBe(summary.totals.invoiceTotalCents);
  });

  it("is idempotent: reseeding replaces demo rows instead of duplicating", async () => {
    const small = generateDemoData({ weeks: 4, customers: 60, seed: 99 });
    await seedDemoData(t.db, small);
    const first = await dbCounts();
    await seedDemoData(t.db, small);
    expect(await dbCounts()).toEqual(first);
    expect(first.customers).toBe(60);
    expect(first.users).toBe(13);
    expect(await dbTotal()).toBe(summarizeDemoData(small).totals.invoiceTotalCents);
    const audits = await t.db.execute<{ n: number }>(
      sql`select count(*)::int as n from audit_log where action = 'bulk_load'`,
    );
    expect(audits[0]?.n).toBe(3);
  });

  it("refuses to run when non-demo data exists, and changes nothing", async () => {
    await t.db.insert(customers).values({ type: "residential", name: "A Real Customer" });
    const before = await dbCounts();
    await expect(
      seedDemoData(t.db, generateDemoData({ weeks: 2, customers: 40 })),
    ).rejects.toBeInstanceOf(DemoSeedRefusedError);
    expect(await dbCounts()).toEqual(before);
  });
});
