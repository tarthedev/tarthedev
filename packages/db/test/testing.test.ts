import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { requireEnv } from "../src/env";
import { customers } from "../src/schema";
import {
  createTestDatabase,
  databaseUrl,
  dropStaleTestDatabases,
  TEST_DATABASE_PREFIX,
} from "../src/testing";

async function databaseExists(name: string): Promise<boolean> {
  const admin = postgres(requireEnv("TEST_DATABASE_URL"), { max: 1, onnotice: () => {} });
  try {
    const rows = await admin`select 1 from pg_database where datname = ${name}`;
    return rows.length > 0;
  } finally {
    await admin.end();
  }
}

describe("createTestDatabase", () => {
  it("creates a migrated, uniquely named database and drops it on close", async () => {
    const a = await createTestDatabase();
    const b = await createTestDatabase();
    try {
      expect(a.name).not.toBe(b.name);
      expect(a.name.startsWith(TEST_DATABASE_PREFIX)).toBe(true);
      expect(await databaseExists(a.name)).toBe(true);

      await a.db.insert(customers).values({ type: "residential", name: "Only In A" });
      expect(await a.db.$count(customers)).toBe(1);
      expect(await b.db.$count(customers)).toBe(0);
    } finally {
      await a.close();
      await b.close();
    }
    expect(await databaseExists(a.name)).toBe(false);
    expect(await databaseExists(b.name)).toBe(false);
    await a.close(); // safe to call twice
  });

  it("can skip migrations", async () => {
    const t = await createTestDatabase({ migrate: false });
    try {
      const rows = await t.sql`
        select 1 from information_schema.tables where table_schema = 'public'
      `;
      expect(rows.length).toBe(0);
    } finally {
      await t.close();
    }
  });

  it("never touches the TEST_DATABASE_URL database itself", async () => {
    const adminName = new URL(requireEnv("TEST_DATABASE_URL")).pathname.slice(1);
    const t = await createTestDatabase();
    try {
      expect(t.name).not.toBe(adminName);
      expect(new URL(t.url).pathname).toBe(`/${t.name}`);
    } finally {
      await t.close();
    }
    expect(await databaseExists(adminName)).toBe(true);
  });

  it("drops only stale test databases", async () => {
    const t = await createTestDatabase({ migrate: false });
    try {
      // A week, so a parallel run's databases are never touched.
      const dropped = await dropStaleTestDatabases(7 * 24 * 60 * 60 * 1000);
      expect(dropped).not.toContain(t.name);
      expect(await databaseExists(t.name)).toBe(true);
    } finally {
      await t.close();
    }
  });

  it("builds database URLs on the same server", () => {
    expect(databaseUrl("postgres://u:p@localhost:5432/admin", "other")).toBe(
      "postgres://u:p@localhost:5432/other",
    );
  });
});
