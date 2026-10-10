import { formatCents, parseMoney } from "@dwrg/core";
import {
  auditLog,
  customers,
  employees,
  equipment,
  invoiceLines,
  invoices,
  jobCosts,
  jobs,
  payments,
  pricebookItems,
  stImportBatches,
  stImportRows,
  user,
} from "@dwrg/db";
import type { TestDatabase } from "@dwrg/db/testing";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseCsv, preview, type ReportType, runImport, StImportError } from "../src";
import { DEMO_FILE_NAMES, readDemoFixtures } from "../src/demo";
import { editCsv, importDatabase, OFFICE_USER_ID } from "./helpers";

const fixtures = readDemoFixtures();

describe("changes, bad rows and failures", () => {
  let t: TestDatabase;

  const load = (
    type: ReportType,
    csvText = fixtures.files[type],
    fileName = DEMO_FILE_NAMES[type],
  ) => runImport({ db: t.db, csvText, reportType: type, fileName, uploadedBy: OFFICE_USER_ID });

  const rowsOf = async (batchId: string) =>
    t.db
      .select({
        rowNumber: stImportRows.rowNumber,
        result: stImportRows.result,
        error: stImportRows.error,
        stId: stImportRows.stId,
      })
      .from(stImportRows)
      .where(eq(stImportRows.batchId, batchId))
      .orderBy(asc(stImportRows.rowNumber));

  beforeAll(async () => {
    t = await importDatabase();
    // Someone set up in this system before the first import (no ServiceTitan ID yet).
    await t.db.insert(user).values({
      id: "pre-existing-tech",
      name: "Early Bird",
      email: "early.bird@dwrg.example",
      role: "installer",
    });
    await t.db.insert(employees).values({ userId: "pre-existing-tech", phone: "+12525550100" });
    for (const type of ["technicians", "pricebook", "customers"] as const) {
      const r = await load(type);
      expect(r.rejected).toBe(0);
    }
  });
  afterAll(async () => {
    await t?.close();
  });

  it("updates a changed customer row and audits before and after", async () => {
    const changed = editCsv(fixtures.files.customers, (rows) =>
      rows.map((row) =>
        row["Customer ID"] === "DEMO-C-00001"
          ? { ...row, "Customer Name": "Hank Erdman Jr." }
          : row,
      ),
    );
    const r = await load("customers", changed);
    const touched = (await rowsOf(r.batchId)).filter((row) => row.result === "updated");
    expect(r).toMatchObject({ status: "imported", inserted: 0, rejected: 0 });
    expect(r.updated).toBe(2); // the customer's location row and contact row
    expect(r.unchanged).toBe(r.rowsRead - 2);
    expect(touched.map((row) => row.stId)).toEqual(["DEMO-L-00001", "DEMO-CT-00001"]);

    const [row] = await t.db.select().from(customers).where(eq(customers.stId, "DEMO-C-00001"));
    expect(row?.name).toBe("Hank Erdman Jr.");
    const [audit] = await t.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.tableName, "customers"), eq(auditLog.action, "update")));
    expect(audit).toMatchObject({
      rowId: row?.id,
      userId: OFFICE_USER_ID,
      before: expect.objectContaining({ name: "Hank Erdman" }),
      after: expect.objectContaining({ name: "Hank Erdman Jr." }),
    });
    expect(audit?.reason).toContain(`(batch ${r.batchId}) row`);
  });

  it('updates a changed price ("$1,234.50" is 123450 cents) and keeps our own spiff', async () => {
    await t.db
      .update(pricebookItems)
      .set({ spiffCents: 5_000 })
      .where(eq(pricebookItems.code, "HVAC-ECM"));
    const changed = editCsv(fixtures.files.pricebook, (rows) =>
      rows.map((row) => (row.Code === "HVAC-ECM" ? { ...row, Price: "$1,234.50" } : row)),
    );
    const r = await load("pricebook", changed);
    expect(r).toMatchObject({ inserted: 0, updated: 1, rejected: 0 });
    const [item] = await t.db
      .select()
      .from(pricebookItems)
      .where(eq(pricebookItems.code, "HVAC-ECM"));
    expect(item).toMatchObject({ priceCents: 123_450, spiffCents: 5_000 });
  });

  it("links a person already set up here and never changes roles from an import", async () => {
    const changed = editCsv(fixtures.files.technicians, (rows) => [
      // A tech promoted to Owner in ServiceTitan stays a tech here.
      ...rows.map((row) => (row.Role === "Technician" ? { ...row, Role: "Owner" } : row)),
      {
        "Technician ID": "ST-777",
        Name: "Early Bird",
        Email: "Early.Bird@dwrg.example",
        "Mobile Phone": "(252) 555-0100",
        Role: "Installer",
        "Business Units": "HVAC Replacement",
        Skills: "HVAC",
        "Hire Date": "3/1/2021",
        Active: "Yes",
      },
    ]);
    const r = await load("technicians", changed);
    expect(r.rejected).toBe(0);
    expect(r.inserted).toBe(0);
    const techs = await t.db.select({ role: user.role }).from(user);
    expect(techs.filter((u) => u.role === "owner")).toHaveLength(1);
    const [linked] = await t.db.select().from(employees).where(eq(employees.stId, "ST-777"));
    expect(linked).toMatchObject({
      userId: "pre-existing-tech",
      businessUnits: ["hvac_replacement"],
    });
    expect(await t.db.$count(user)).toBe(1 + 1 + 13);
  });

  it("rejects bad rows with readable errors without stopping the batch", async () => {
    const bad = editCsv(fixtures.files.equipment, (rows) => {
      const [a, b, c, d, e, f] = rows;
      if (!a || !b || !c || !d || !e || !f) throw new Error("fixture too small");
      return [
        { ...a, "Location ID": "NOPE-1" },
        { ...b, "Install Year": "19x5" },
        { ...c, "Equipment ID": "" },
        { ...d, "Warranty End": "13/45/2026" },
        { ...e, "Equipment Type": "Geothermal Loop" },
        f,
      ];
    });
    const r = await load("equipment", bad, "equipment-bad.csv");
    expect(r).toMatchObject({ status: "imported", rowsRead: 6, inserted: 2, rejected: 4 });
    expect(r.errors).toEqual([
      {
        rowNumber: 2,
        column: null,
        message: "Location NOPE-1 is not in the system yet. Import the customers report first.",
      },
      {
        rowNumber: 3,
        column: null,
        message: 'Install Year: "19x5" is not a whole number in range.',
      },
      { rowNumber: 4, column: null, message: "Equipment ID is blank." },
      {
        rowNumber: 5,
        column: null,
        message: 'Warranty End: "13/45/2026" is not a date like 10/6/2025.',
      },
    ]);
    const stored = await rowsOf(r.batchId);
    expect(stored.map((row) => row.result)).toEqual([
      "rejected",
      "rejected",
      "rejected",
      "rejected",
      "inserted",
      "inserted",
    ]);
    expect(stored[1]?.error).toBe('Install Year: "19x5" is not a whole number in range.');
    const [other] = await t.db.select().from(equipment).where(eq(equipment.stId, "DEMO-EQ-00005"));
    expect(other).toMatchObject({ kind: "other", notes: "ServiceTitan type: Geothermal Loop" });
  });

  it("previews the same problems with row numbers and writes nothing", async () => {
    const bad = editCsv(fixtures.files.equipment, (rows) =>
      rows.map((row, i) => (i === 3 ? { ...row, "Warranty End": "someday" } : row)),
    );
    const batchesBefore = await t.db.$count(stImportBatches);
    const p = await preview({ db: t.db, csvText: bad, limit: 3 });
    expect(p.reportType).toBe("equipment");
    expect(p.fileError).toBeNull();
    expect(p.rowCount).toBe(241);
    expect(p.rows).toHaveLength(3);
    expect(p.rows[0]).toMatchObject({
      rowNumber: 2,
      stId: "DEMO-EQ-00001",
      fields: { equipmentId: "DEMO-EQ-00001", equipmentType: "Furnace", installYear: "2019" },
      values: { kind: "furnace", installYear: 2019, warrantyEnd: "2029-09-15", active: true },
    });
    expect(p.errors).toEqual([
      {
        rowNumber: 5,
        column: "Warranty End",
        message: 'Warranty End: "someday" is not a date like 10/6/2025.',
      },
    ]);
    expect(p.rejectedRows).toBe(1);
    expect(await t.db.$count(stImportBatches)).toBe(batchesBefore);
  });

  it("rejects a whole invoice when one of its rows is bad, and invoices that don't add up", async () => {
    const byInvoice = new Map<string, Record<string, string>[]>();
    editCsv(fixtures.files.invoices, (rows) => {
      for (const row of rows) {
        const key = row["Invoice #"] ?? "";
        if (key) byInvoice.set(key, [...(byInvoice.get(key) ?? []), row]);
      }
      return rows;
    });
    const multi = [...byInvoice.values()].filter((rows) => rows.length >= 2);
    const [first, second, third] = multi;
    if (!first || !second || !third) throw new Error("fixture has too few multi-line invoices");
    const badQuantity = first.map((row, i) => (i === 1 ? { ...row, Quantity: "abc" } : row));
    const wrongTotal = second.map((row) => ({ ...row, Total: "$1.00" }));
    const text = editCsv(fixtures.files.invoices, () => [...badQuantity, ...wrongTotal, ...third]);
    const r = await load("invoices", text, "invoices-bad.csv");
    expect(r.status).toBe("imported");
    expect(r.inserted).toBe(third.length);
    expect(r.rejected).toBe(first.length + second.length);
    const stored = await rowsOf(r.batchId);
    const firstInvoice = first[0]?.["Invoice #"];
    expect(stored[0]?.error).toBe(
      `Not imported because row 3 of invoice ${firstInvoice} has a problem.`,
    );
    expect(stored[1]?.error).toBe('Quantity: "abc" is not a quantity with up to 3 decimal places.');
    const wrong = stored[first.length];
    expect(wrong?.error).toMatch(
      /^Total is \$1\.00, but Subtotal − Discount \+ Tax is \$[\d,]+\.\d\d\.$/,
    );
    expect(await t.db.$count(invoices)).toBe(1);
  });

  it("soft-deletes a line that left the invoice in ServiceTitan, with its cost", async () => {
    // An invoice with a job and a line that has a cost.
    const all = editCsv(fixtures.files.invoices, (rows) => rows);
    const groups = new Map<string, Record<string, string>[]>();
    editCsv(all, (rows) => {
      for (const row of rows) {
        const key = row["Invoice #"] ?? "";
        if (key) groups.set(key, [...(groups.get(key) ?? []), row]);
      }
      return rows;
    });
    const rows = [...groups.values()].find(
      (g) => g.length >= 3 && g.some((row) => parseMoney(row.Cost ?? "$0") > 0) && g[0]?.["Job #"],
    );
    if (!rows) throw new Error("no suitable invoice in the fixture");
    const imported = await load(
      "invoices",
      editCsv(all, () => rows),
      "one-invoice.csv",
    );
    expect(imported.rejected).toBe(0);

    const removed = rows.find((row) => parseMoney(row.Cost ?? "$0") > 0);
    if (!removed) throw new Error("no line with a cost");
    const cents = (field: string) => parseMoney(removed[field] ?? "$0");
    const gross = cents("Item Total") + cents("Item Discount");
    const lessLine = rows
      .filter((row) => row !== removed)
      .map((row) => {
        const minus = (field: string, by: number) =>
          formatCents(parseMoney(row[field] ?? "$0") - by);
        return {
          ...row,
          Subtotal: minus("Subtotal", gross),
          Discount: minus("Discount", cents("Item Discount")),
          Tax: minus("Tax", cents("Item Tax")),
          Total: minus("Total", cents("Item Total") + cents("Item Tax")),
          Balance: minus("Balance", 0),
        };
      });
    const r = await load(
      "invoices",
      editCsv(all, () => lessLine),
      "one-invoice-less.csv",
    );
    expect(r).toMatchObject({ rejected: 0, inserted: 0 });
    expect(r.updated).toBeGreaterThanOrEqual(1);

    const lineStId = removed["Invoice Item ID"] ?? "";
    const [line] = await t.db.select().from(invoiceLines).where(eq(invoiceLines.stId, lineStId));
    expect(line?.deletedAt).toBeInstanceOf(Date);
    const [cost] = await t.db
      .select()
      .from(jobCosts)
      .where(eq(jobCosts.sourceId, line?.id ?? ""));
    expect(cost?.deletedAt).toBeInstanceOf(Date);
    const deletions = await t.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "soft_delete"), eq(auditLog.rowId, line?.id ?? "")));
    expect(deletions).toHaveLength(1);
    expect(deletions[0]?.reason).toContain("line no longer on the ServiceTitan invoice");
  });

  it("imports a job before its callback even when the export lists the callback first", async () => {
    const text = editCsv(fixtures.files.invoices, (rows) => {
      const jobNumbers = new Set(rows.map((row) => row["Job #"]));
      const callback = rows.find((row) => row["Recall For"] && jobNumbers.has(row["Recall For"]));
      if (!callback) throw new Error("fixture has no callback");
      const original = callback["Recall For"];
      return [
        ...rows.filter((row) => row["Job #"] === callback["Job #"]),
        ...rows.filter((row) => row["Job #"] === original),
      ];
    });
    const p = await preview({ db: t.db, csvText: text });
    expect(p.errors).toEqual([]);
    const r = await load("invoices", text, "callback-first.csv");
    expect(r).toMatchObject({ rejected: 0, updated: 0, unchanged: 0 });
    expect(r.inserted).toBe(r.rowsRead);
    const [first] = parseCsv(text).records;
    const [callback] = await t.db
      .select()
      .from(jobs)
      .where(eq(jobs.stId, first?.cells["Job #"] ?? ""));
    const [original] = await t.db
      .select()
      .from(jobs)
      .where(eq(jobs.stId, first?.cells["Recall For"] ?? ""));
    expect(original?.id).toBeDefined();
    expect(callback).toMatchObject({
      callbackOfJobId: original?.id,
      callbackTechCaused: first?.cells["Recall Tech Caused"] === "Yes",
    });
  });

  it("rejects a record whose details disagree between rows", async () => {
    const text = editCsv(fixtures.files.customers, (rows) => {
      const [a] = rows;
      if (!a) throw new Error("empty fixture");
      const fresh = { ...a, "Customer ID": "NEW-1", "Location ID": "NEW-L-1" };
      return [fresh, { ...fresh, "Location ID": "NEW-L-2", "Customer Name": "Someone Else" }];
    });
    const r = await load("customers", text, "conflict.csv");
    expect(r).toMatchObject({ inserted: 1, rejected: 1 });
    expect(r.errors[0]?.message).toBe(
      "Customer NEW-1 is also on row 2 with different details (name).",
    );
  });

  it("holds back an invoice whose header differs between its rows", async () => {
    const text = editCsv(fixtures.files.invoices, (rows) => {
      const number = rows.find(
        (row, i) => row["Invoice #"] && rows[i + 1]?.["Invoice #"] === row["Invoice #"],
      )?.["Invoice #"];
      const lines = rows.filter((row) => row["Invoice #"] === number);
      return lines.map((row, i) => (i === 1 ? { ...row, Total: "$9,999.99" } : row));
    });
    const p = await preview({ db: t.db, csvText: text });
    expect(p.reportType).toBe("invoices");
    expect(p.errors[0]).toMatchObject({ rowNumber: 2 });
    expect(p.errors[0]?.message).toMatch(
      /^Not imported because row 3 of invoice .+ has a problem\.$/,
    );
    expect(p.errors[1]).toMatchObject({
      rowNumber: 3,
      message: expect.stringMatching(
        /^Invoice .+ is also on row 2 with different details \(total\)\.$/,
      ),
    });
  });

  it("rejects payments for invoices that aren't imported", async () => {
    const text = editCsv(fixtures.files.payments, (rows) =>
      rows.slice(0, 1).map((row) => ({ ...row, "Invoice #": "DEMO-I-999999" })),
    );
    const r = await load("payments", text, "orphan-payment.csv");
    expect(r.rejected).toBe(1);
    expect(r.errors[0]?.message).toBe(
      "Invoice DEMO-I-999999 is not in the system yet. Import the invoices report first.",
    );
  });

  it("records a file with missing columns as a failed batch and keeps its raw rows", async () => {
    const text = editCsv(fixtures.files.equipment, (rows) =>
      rows.slice(0, 3).map(({ "Equipment ID": _drop, ...rest }) => rest),
    ).replace("Equipment ID,", "");
    const r = await load("equipment", text, "no-ids.csv");
    expect(r).toMatchObject({
      status: "failed",
      error: "The file has no Equipment ID column, which the equipment report needs.",
      rowsRead: 3,
      inserted: 0,
    });
    const [batch] = await t.db
      .select()
      .from(stImportBatches)
      .where(eq(stImportBatches.id, r.batchId));
    expect(batch).toMatchObject({ status: "failed", rowsRead: 3 });
    expect(await rowsOf(r.batchId)).toHaveLength(3);
  });

  it("won't take an invoice number that belongs to an invoice created in this system", async () => {
    const numbers = parseCsv(fixtures.files.invoices)
      .records.map((record) => record.cells["Invoice #"] ?? "")
      .filter((number) => number !== "");
    const lastNumber = numbers.at(-1);
    if (!lastNumber) throw new Error("no invoice in the fixture");
    const [customer] = await t.db.select({ id: customers.id }).from(customers).limit(1);
    await t.db.insert(invoices).values({
      origin: "new",
      number: lastNumber,
      customerId: customer?.id ?? "",
      invoiceDate: "2026-01-09",
    });
    const text = editCsv(fixtures.files.invoices, (rows) =>
      rows.filter((row) => row["Invoice #"] === lastNumber),
    );
    const r = await load("invoices", text, "taken-number.csv");
    expect(r.inserted).toBe(0);
    expect(r.rejected).toBeGreaterThan(0);
    expect(r.errors[0]?.message).toBe(
      `Invoice number ${lastNumber} already belongs to an invoice created in this system.`,
    );
  });

  it("never changes an invoice or payment created in this system", async () => {
    const numbers = [
      ...new Set(
        parseCsv(fixtures.files.invoices)
          .records.map((record) => record.cells["Invoice #"] ?? "")
          .filter((number) => number !== ""),
      ),
    ];
    const stId = numbers.at(-2);
    const payment = parseCsv(fixtures.files.payments).records[0]?.cells;
    if (!stId || !payment) throw new Error("fixture too small");
    const [customer] = await t.db.select({ id: customers.id }).from(customers).limit(1);
    const [ours] = await t.db
      .insert(invoices)
      .values({
        origin: "new",
        stId,
        number: "NEW-100001",
        customerId: customer?.id ?? "",
        invoiceDate: "2026-01-09",
      })
      .returning();
    await t.db.insert(payments).values({
      origin: "new",
      stId: payment["Payment ID"],
      invoiceId: ours?.id ?? "",
      method: "check",
      amountCents: 100,
      receivedAt: new Date("2026-01-09T15:00:00Z"),
    });

    const invoiceRows = editCsv(fixtures.files.invoices, (rows) =>
      rows.filter((row) => row["Invoice #"] === stId),
    );
    const r = await load("invoices", invoiceRows, "owned-invoice.csv");
    expect(r).toMatchObject({ inserted: 0, updated: 0, unchanged: 0 });
    expect(r.rejected).toBe(r.rowsRead);
    expect(r.errors[0]?.message).toBe(
      `Invoice ${stId} was created in this system, so ServiceTitan rows can't change it.`,
    );

    const paymentRows = editCsv(fixtures.files.payments, (rows) => rows.slice(0, 1));
    const p = await load("payments", paymentRows, "owned-payment.csv");
    expect(p).toMatchObject({ inserted: 0, rejected: 1 });
    expect(p.errors[0]?.message).toBe(
      `Payment ${payment["Payment ID"]} was created in this system, so ServiceTitan rows can't change it.`,
    );
    const [after] = await t.db
      .select()
      .from(invoices)
      .where(eq(invoices.id, ours?.id ?? ""));
    expect(after).toMatchObject({ origin: "new", number: "NEW-100001", totalCents: 0 });
  });

  it("rolls everything back when the database refuses a row mid-import", async () => {
    await t.sql.unsafe(`
      create function reject_boom() returns trigger language plpgsql as $$
      begin
        if new.name = 'Boom' then
          raise exception 'no booms' using errcode = 'check_violation',
            constraint = 'contacts_boom_check', table = tg_table_name;
        end if;
        return new;
      end $$;
      create trigger contacts_boom before insert on contacts for each row execute function reject_boom();
    `);
    try {
      const text = editCsv(fixtures.files.customers, (rows) => {
        const [a] = rows;
        if (!a) throw new Error("empty fixture");
        const make = (n: number, contactName: string) => ({
          ...a,
          "Customer ID": `ROLLBACK-${n}`,
          "Location ID": "",
          "Contact ID": `ROLLBACK-CT-${n}`,
          "Contact Name": contactName,
        });
        return [make(1, "Fine"), make(2, "Boom"), make(3, "Fine Too")];
      });
      const r = await load("customers", text, "boom.csv");
      expect(r).toMatchObject({
        status: "failed",
        inserted: 0,
        error:
          "The import stopped at row 3: A value breaks the rule contacts_boom_check in contacts. Nothing was imported.",
      });
      expect(await t.db.$count(customers, eq(customers.stId, "ROLLBACK-1"))).toBe(0);
      expect(await rowsOf(r.batchId)).toHaveLength(3);
    } finally {
      await t.sql.unsafe("drop trigger contacts_boom on contacts; drop function reject_boom();");
    }
  });

  it("refuses an unknown uploader before writing anything", async () => {
    const before = await t.db.$count(stImportBatches);
    await expect(
      runImport({
        db: t.db,
        csvText: fixtures.files.technicians,
        fileName: "x.csv",
        uploadedBy: "nobody",
      }),
    ).rejects.toThrow(StImportError);
    expect(await t.db.$count(stImportBatches)).toBe(before);
  });
});
