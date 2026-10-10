import { user } from "@dwrg/db";
import { createTestDatabase, type TestDatabase } from "@dwrg/db/testing";
import { parseCsv, toCsv } from "../src";

export const OFFICE_USER_ID = "office-manager-1";

/** A throwaway database with the office manager who uploads the files. */
export async function importDatabase(): Promise<TestDatabase> {
  const t = await createTestDatabase();
  await t.db.insert(user).values({
    id: OFFICE_USER_ID,
    name: "Office Manager",
    email: "office@dwrg.example",
    role: "manager",
  });
  return t;
}

/** Edits a CSV as header-keyed rows and writes it back. */
export function editCsv(
  text: string,
  edit: (rows: Record<string, string>[]) => Record<string, string>[],
): string {
  const csv = parseCsv(text);
  const rows = edit(csv.records.map((record) => ({ ...record.cells })));
  return toCsv(
    csv.headers,
    rows.map((row) => csv.headers.map((header) => row[header] ?? "")),
  );
}
