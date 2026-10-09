import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  insertWithAudit,
  softDeleteWithAudit,
  updateWithAudit,
  upsertWithAudit,
  writeAudit,
} from "../src/audit";
import { auditLog, customers, invoiceLines, invoices, user } from "../src/schema";
import { createTestDatabase, type TestDatabase } from "../src/testing";

describe("audit helpers", () => {
  let t: TestDatabase;
  const office = "user-office-1";

  beforeAll(async () => {
    t = await createTestDatabase();
    await t.db
      .insert(user)
      .values({ id: office, name: "Office", email: "office@example.com", role: "manager" });
  });
  afterAll(async () => {
    await t?.close();
  });

  const auditFor = (rowId: string) =>
    t.db.select().from(auditLog).where(eq(auditLog.rowId, rowId)).orderBy(asc(auditLog.id));

  it("writeAudit appends who, when, before, after and why", async () => {
    await writeAudit(t.db, {
      tableName: "invoices",
      rowId: "inv-1",
      action: "update",
      before: { balanceCents: 1000 },
      after: { balanceCents: 0 },
      userId: office,
      reason: "Paid by check",
    });
    const [entry] = await auditFor("inv-1");
    expect(entry).toMatchObject({
      tableName: "invoices",
      action: "update",
      before: { balanceCents: 1000 },
      after: { balanceCents: 0 },
      userId: office,
      reason: "Paid by check",
    });
    expect(entry?.at).toBeInstanceOf(Date);
  });

  it("insertWithAudit stores the new row as `after`", async () => {
    const row = await insertWithAudit(
      t.db,
      customers,
      { type: "commercial", name: "Pelican Grill", termsNetDays: 30 },
      { userId: office, reason: "New customer" },
    );
    const entries = await auditFor(row.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ tableName: "customers", action: "insert", before: null });
    expect(entries[0]?.after).toMatchObject({
      id: row.id,
      name: "Pelican Grill",
      termsNetDays: 30,
    });
  });

  it("updateWithAudit records the exact before and after in one transaction", async () => {
    const row = await insertWithAudit(
      t.db,
      customers,
      { type: "residential", name: "Ann Lee" },
      { userId: office },
    );
    const updated = await updateWithAudit(
      t.db,
      customers,
      row.id,
      { termsNetDays: 15, notes: "Prefers mornings" },
      { userId: office, reason: "Customer asked" },
    );
    expect(updated.termsNetDays).toBe(15);
    const entries = await auditFor(row.id);
    expect(entries.map((e) => e.action)).toEqual(["insert", "update"]);
    expect(entries[1]?.before).toMatchObject({ termsNetDays: 0, notes: null });
    expect(entries[1]?.after).toMatchObject({ termsNetDays: 15, notes: "Prefers mornings" });
    expect(entries[1]?.reason).toBe("Customer asked");
  });

  it("softDeleteWithAudit sets deleted_at and never removes the row", async () => {
    const row = await insertWithAudit(
      t.db,
      customers,
      { type: "residential", name: "Bo Dee" },
      { userId: office },
    );
    const deleted = await softDeleteWithAudit(t.db, customers, row.id, {
      userId: office,
      reason: "Duplicate",
    });
    expect(deleted.deletedAt).toBeInstanceOf(Date);
    const [still] = await t.db.select().from(customers).where(eq(customers.id, row.id));
    expect(still?.deletedAt).toBeInstanceOf(Date);
    const entries = await auditFor(row.id);
    expect(entries.at(-1)?.action).toBe("soft_delete");
    expect(entries.at(-1)?.before).toMatchObject({ deletedAt: null });
  });

  it("rolls the audit row back with the change", async () => {
    const row = await insertWithAudit(
      t.db,
      customers,
      { type: "residential", name: "Cy Fox" },
      { userId: office },
    );
    await expect(
      t.db.transaction(async (tx) => {
        await updateWithAudit(tx, customers, row.id, { name: "Changed" }, { userId: office });
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");
    const [after] = await t.db.select().from(customers).where(eq(customers.id, row.id));
    expect(after?.name).toBe("Cy Fox");
    expect((await auditFor(row.id)).map((e) => e.action)).toEqual(["insert"]);
  });

  it("updateWithAudit throws for a missing row and writes nothing", async () => {
    const missing = "00000000-0000-4000-8000-000000000000";
    await expect(
      updateWithAudit(t.db, customers, missing, { name: "X" }, { userId: office }),
    ).rejects.toThrow(/not found/);
    expect(await auditFor(missing)).toHaveLength(0);
  });

  it("upsertWithAudit is idempotent on st_id: inserted, updated, unchanged", async () => {
    const ctx = { userId: null, reason: "ServiceTitan import" };
    const values = {
      stId: "ST-INV-1",
      origin: "servicetitan" as const,
      number: "100",
      customerId: "",
      invoiceDate: "2026-03-02",
      subtotalCents: 50_000,
      totalCents: 50_000,
      balanceCents: 50_000,
    };
    const [customer] = await t.db
      .insert(customers)
      .values({ type: "residential", name: "Imported" })
      .returning();
    values.customerId = customer?.id ?? "";

    const first = await upsertWithAudit(
      t.db,
      invoices,
      invoices.stId,
      "ST-INV-1",
      values,
      ctx,
      "import",
    );
    expect(first.result).toBe("inserted");
    const second = await upsertWithAudit(
      t.db,
      invoices,
      invoices.stId,
      "ST-INV-1",
      values,
      ctx,
      "import",
    );
    expect(second.result).toBe("unchanged");
    const third = await upsertWithAudit(
      t.db,
      invoices,
      invoices.stId,
      "ST-INV-1",
      { ...values, balanceCents: 0 },
      ctx,
      "import",
    );
    expect(third.result).toBe("updated");
    expect(third.row.balanceCents).toBe(0);
    const entries = await auditFor(first.row.id);
    expect(entries.map((e) => e.action)).toEqual(["import", "update"]);
    expect(entries[1]?.before).toMatchObject({ balanceCents: 50_000 });
    expect(entries[1]?.after).toMatchObject({ balanceCents: 0 });

    // numeric quantities compare by value ("1" equals "1.000")
    const line = {
      stId: "ST-IL-1",
      invoiceId: first.row.id,
      description: "Capacitor",
      quantity: "1",
      unitPriceCents: 28_900,
      amountCents: 28_900,
    };
    expect(
      (await upsertWithAudit(t.db, invoiceLines, invoiceLines.stId, "ST-IL-1", line, ctx)).result,
    ).toBe("inserted");
    expect(
      (
        await upsertWithAudit(
          t.db,
          invoiceLines,
          invoiceLines.stId,
          "ST-IL-1",
          { ...line, quantity: "1.000" },
          ctx,
        )
      ).result,
    ).toBe("unchanged");
    expect(
      (
        await upsertWithAudit(
          t.db,
          invoiceLines,
          invoiceLines.stId,
          "ST-IL-1",
          { ...line, quantity: "2" },
          ctx,
        )
      ).result,
    ).toBe("updated");
  });
});
