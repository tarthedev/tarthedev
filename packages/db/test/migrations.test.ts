import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getTableName, isTable } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrationsFolder, runMigrations } from "../src/migrations";
import * as schema from "../src/schema";
import { createTestDatabase, type TestDatabase } from "../src/testing";

const tableNames = Object.values(schema)
  .filter((value) => isTable(value))
  .map((table) => getTableName(table))
  .sort();

describe("migrations", () => {
  let t: TestDatabase;
  beforeAll(async () => {
    t = await createTestDatabase();
  });
  afterAll(async () => {
    await t?.close();
  });

  it("create every table in the schema on a fresh database", async () => {
    const rows = await t.sql<{ table_name: string }[]>`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
      order by table_name
    `;
    expect(rows.map((r) => r.table_name)).toEqual(tableNames);
    expect(tableNames.length).toBeGreaterThanOrEqual(32);
  });

  it("record every migration in the journal and re-run as a no-op", async () => {
    const journal = JSON.parse(
      readFileSync(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
    ) as { entries: unknown[] };
    const count = async () => {
      const [row] = await t.sql<{ n: number }[]>`
        select count(*)::int as n from drizzle.__drizzle_migrations
      `;
      return row?.n;
    };
    expect(await count()).toBe(journal.entries.length);
    await runMigrations(t.url);
    expect(await count()).toBe(journal.entries.length);
  });

  it("store every money and rate column as an integer type", async () => {
    const rows = await t.sql<{ table_name: string; column_name: string; data_type: string }[]>`
      select table_name, column_name, data_type from information_schema.columns
      where table_schema = 'public'
        and (column_name like '%\\_cents' or column_name like '%\\_cents\\_%'
             or column_name like '%\\_bps' or column_name in ('ours', 'servicetitan_summary', 'diff'))
    `;
    expect(rows.map((r) => `${r.table_name}.${r.column_name}`)).toContain(
      "pay_rates.wage_cents_per_hour",
    );
    expect(rows.length).toBeGreaterThan(25);
    for (const row of rows) {
      expect(
        ["integer", "bigint"],
        `${row.table_name}.${row.column_name} is ${row.data_type}`,
      ).toContain(row.data_type);
    }
  });

  it("enforce value lists and money invariants with CHECK constraints", async () => {
    await expect(
      t.sql`insert into "user" (id, name, email, role) values ('u1', 'A', 'a@example.com', 'boss')`,
    ).rejects.toThrow(/user_role_check/);

    const [customer] = await t.sql<{ id: string }[]>`
      insert into customers (type, name) values ('residential', 'Test Person') returning id
    `;
    await expect(
      t.sql`
        insert into invoices (number, customer_id, invoice_date, subtotal_cents, discount_cents, tax_cents, total_cents)
        values ('X-1', ${customer?.id ?? ""}, '2026-01-05', 10000, 0, 700, 10000)
      `,
    ).rejects.toThrow(/invoices_total_check/);
    await expect(
      t.sql`
        insert into invoices (origin, number, customer_id, invoice_date)
        values ('servicetitan', 'X-2', ${customer?.id ?? ""}, '2026-01-05')
      `,
    ).rejects.toThrow(/invoices_origin_st_id_check/);
  });

  it("keep audit_log append-only", async () => {
    await t.sql`
      insert into audit_log (table_name, row_id, action, user_id, reason)
      values ('customers', 'x', 'insert', null, 'test')
    `;
    await expect(t.sql`update audit_log set reason = 'changed'`).rejects.toThrow(/append-only/);
    await expect(t.sql`delete from audit_log`).rejects.toThrow(/append-only/);
  });
});
