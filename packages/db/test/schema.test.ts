import { getTableColumns, isTable, type Table } from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "../src/schema";

const tables = (Object.values(schema) as unknown[]).filter((value): value is PgTable =>
  isTable(value),
);

describe("schema conventions", () => {
  it("stores money (*_cents) and rates (*_bps) as integers, never floats or numerics", () => {
    const moneyColumns: string[] = [];
    for (const table of tables) {
      const { name } = getTableConfig(table);
      for (const column of Object.values(getTableColumns(table as Table))) {
        if (!/_(cents|bps)($|_)/.test(column.name)) continue;
        moneyColumns.push(`${name}.${column.name}`);
        expect(["PgInteger", "PgBigInt53"], `${name}.${column.name}`).toContain(column.columnType);
      }
    }
    expect(moneyColumns).toContain("invoices.total_cents");
    expect(moneyColumns).toContain("pay_rates.burden_bps");
    expect(moneyColumns).toContain("pay_rates.wage_cents_per_hour");
    expect(moneyColumns).toContain("pricebook_items.spiff_cents");
  });

  it("gives every st_id column a unique index", () => {
    const withStId = tables.filter((table) =>
      getTableConfig(table).columns.some((c) => c.name === "st_id"),
    );
    expect(withStId.length).toBeGreaterThanOrEqual(17);
    for (const table of withStId) {
      const config = getTableConfig(table);
      if (config.name === "st_import_rows") continue; // raw rows repeat across batches
      const unique = config.indexes.some(
        (index) =>
          index.config.unique &&
          index.config.columns.length === 1 &&
          (index.config.columns[0] as { name?: string }).name === "st_id",
      );
      expect(unique, `${config.name} needs a unique st_id index`).toBe(true);
    }
  });

  it("uses uuid primary keys with soft delete on business tables", () => {
    const business = [
      "customers",
      "locations",
      "contacts",
      "equipment",
      "memberships",
      "pricebook_items",
      "jobs",
      "appointments",
      "time_entries",
      "invoices",
      "invoice_lines",
      "payments",
      "job_costs",
      "employees",
      "business_units",
    ];
    for (const name of business) {
      const table = tables.find((t) => getTableConfig(t).name === name);
      expect(table, name).toBeDefined();
      const columns = getTableConfig(table as PgTable).columns;
      const id = columns.find((c) => c.name === "id");
      expect(id?.columnType, `${name}.id`).toBe("PgUUID");
      expect(id?.primary, `${name}.id`).toBe(true);
      for (const column of ["created_at", "updated_at", "created_by", "deleted_at"]) {
        expect(
          columns.some((c) => c.name === column),
          `${name}.${column}`,
        ).toBe(true);
      }
    }
  });

  it("keeps Better Auth's field names on the auth tables", () => {
    expect(Object.keys(getTableColumns(schema.user))).toEqual(
      expect.arrayContaining([
        "id",
        "name",
        "email",
        "emailVerified",
        "image",
        "createdAt",
        "updatedAt",
        "role",
        "active",
      ]),
    );
    expect(Object.keys(getTableColumns(schema.session))).toEqual(
      expect.arrayContaining([
        "id",
        "expiresAt",
        "token",
        "createdAt",
        "updatedAt",
        "ipAddress",
        "userAgent",
        "userId",
      ]),
    );
    expect(Object.keys(getTableColumns(schema.account))).toEqual(
      expect.arrayContaining([
        "id",
        "accountId",
        "providerId",
        "userId",
        "accessToken",
        "refreshToken",
        "idToken",
        "accessTokenExpiresAt",
        "refreshTokenExpiresAt",
        "scope",
        "password",
        "createdAt",
        "updatedAt",
      ]),
    );
    expect(Object.keys(getTableColumns(schema.verification))).toEqual(
      expect.arrayContaining(["id", "identifier", "value", "expiresAt", "createdAt", "updatedAt"]),
    );
  });
});
