import {
  auditLog,
  contacts,
  customers,
  employees,
  equipment,
  invoiceLines,
  invoices,
  jobCosts,
  jobs,
  locations,
  memberships,
  payments,
  pricebookItems,
  stImportBatches,
  stImportRows,
  timeEntries,
} from "@dwrg/db";
import { generateDemoData, summarizeDemoData } from "@dwrg/db/demo";
import type { TestDatabase } from "@dwrg/db/testing";
import { and, asc, count, eq, isNotNull, isNull, sql, sum } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  compareWithSummary,
  computeTotals,
  type ImportResult,
  parseCsv,
  REPORT_TYPES,
  type ReportType,
  runImport,
} from "../src";
import { DEMO_EXPORT_OPTIONS, DEMO_FILE_NAMES, readDemoFixtures } from "../src/demo";
import { importDatabase, OFFICE_USER_ID } from "./helpers";

/**
 * The month-1 exit test (docs/04): a full import of the demo exports matches
 * their summary totals per business unit and year, and re-importing changes nothing.
 */
describe("full import of the demo exports", () => {
  const fixtures = readDemoFixtures();
  const data = generateDemoData(DEMO_EXPORT_OPTIONS);
  const demo = summarizeDemoData(data);
  const first = new Map<ReportType, ImportResult>();
  const again = new Map<ReportType, ImportResult>();
  let t: TestDatabase;

  beforeAll(async () => {
    t = await importDatabase();
    for (const type of REPORT_TYPES) {
      first.set(
        type,
        await runImport({
          db: t.db,
          csvText: fixtures.files[type],
          reportType: type,
          fileName: DEMO_FILE_NAMES[type],
          uploadedBy: OFFICE_USER_ID,
        }),
      );
    }
    for (const type of REPORT_TYPES) {
      again.set(
        type,
        await runImport({
          db: t.db,
          csvText: fixtures.files[type],
          fileName: DEMO_FILE_NAMES[type],
          uploadedBy: OFFICE_USER_ID,
        }),
      );
    }
  });
  afterAll(async () => {
    await t?.close();
  });

  const result = (map: Map<ReportType, ImportResult>, type: ReportType) => {
    const found = map.get(type);
    if (!found) throw new Error(`no ${type} import`);
    return found;
  };

  it.each(REPORT_TYPES)("imports every %s row", (type) => {
    const r = result(first, type);
    expect(r.errors).toEqual([]);
    expect(r).toMatchObject({
      status: "imported",
      reportType: type,
      rowsRead: parseCsv(fixtures.files[type]).records.length,
      rejected: 0,
      updated: 0,
      unchanged: 0,
    });
    expect(r.inserted).toBe(r.rowsRead);
  });

  it.each(REPORT_TYPES)("re-importing %s gives 0 inserted and every row unchanged", (type) => {
    const r = result(again, type);
    expect(r.reportType).toBe(type);
    expect(r).toMatchObject({ status: "imported", inserted: 0, updated: 0, rejected: 0 });
    expect(r.unchanged).toBe(r.rowsRead);
  });

  it("creates one row per demo record, all marked as ServiceTitan's", async () => {
    const counts = {
      employees: await t.db.$count(employees),
      pricebookItems: await t.db.$count(pricebookItems),
      customers: await t.db.$count(customers),
      locations: await t.db.$count(locations),
      contacts: await t.db.$count(contacts),
      equipment: await t.db.$count(equipment),
      memberships: await t.db.$count(memberships),
      jobs: await t.db.$count(jobs),
      invoices: await t.db.$count(invoices),
      invoiceLines: await t.db.$count(invoiceLines),
      payments: await t.db.$count(payments),
      timeEntries: await t.db.$count(timeEntries),
    };
    expect(counts).toEqual({
      employees: data.employees.length,
      pricebookItems: data.pricebookItems.length,
      customers: data.customers.length,
      locations: data.locations.length,
      contacts: data.contacts.length,
      equipment: data.equipment.length,
      memberships: data.memberships.length,
      jobs: data.jobs.length,
      invoices: data.invoices.length,
      invoiceLines: data.invoiceLines.length,
      payments: data.payments.length,
      timeEntries: data.timeEntries.length,
    });
    expect(await t.db.$count(jobs, eq(jobs.origin, "new"))).toBe(0);
    expect(await t.db.$count(invoices, eq(invoices.origin, "new"))).toBe(0);
    expect(await t.db.$count(payments, eq(payments.origin, "new"))).toBe(0);
    expect(await t.db.$count(equipment, isNotNull(equipment.deletedAt))).toBe(
      data.equipment.filter((e) => e.deletedAt).length,
    );
  });

  it("stores money exactly as the demo data has it, to the cent", async () => {
    const [invoiceTotals] = await t.db
      .select({
        subtotal: sum(invoices.subtotalCents).mapWith(Number),
        discount: sum(invoices.discountCents).mapWith(Number),
        tax: sum(invoices.taxCents).mapWith(Number),
        total: sum(invoices.totalCents).mapWith(Number),
        balance: sum(invoices.balanceCents).mapWith(Number),
      })
      .from(invoices);
    expect(invoiceTotals).toEqual({
      subtotal: demo.totals.invoiceSubtotalCents,
      discount: demo.totals.invoiceDiscountCents,
      tax: demo.totals.invoiceTaxCents,
      total: demo.totals.invoiceTotalCents,
      balance: demo.totals.openBalanceCents,
    });
    const [paid] = await t.db
      .select({
        amount: sum(payments.amountCents).mapWith(Number),
        fees: sum(payments.feeCents).mapWith(Number),
      })
      .from(payments);
    expect(paid).toEqual({ amount: demo.totals.paymentsCents, fees: demo.totals.paymentFeesCents });

    // Every demo invoice, line and payment matches field by field.
    const byNumber = new Map((await t.db.select().from(invoices)).map((row) => [row.number, row]));
    for (const inv of data.invoices) {
      expect(byNumber.get(inv.number)).toMatchObject({
        invoiceDate: inv.invoiceDate,
        dueDate: inv.dueDate,
        status: inv.status,
        subtotalCents: inv.subtotalCents,
        discountCents: inv.discountCents,
        taxCents: inv.taxCents,
        totalCents: inv.totalCents,
        balanceCents: inv.balanceCents,
        billingStage: inv.billingStage ?? null,
        paidInFullAt: inv.paidInFullAt ?? null,
      });
    }
    const lines = new Map((await t.db.select().from(invoiceLines)).map((row) => [row.stId, row]));
    for (const line of data.invoiceLines) {
      expect(lines.get(line.stId ?? "")).toMatchObject({
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        discountCents: line.discountCents,
        amountCents: line.amountCents,
        taxCents: line.taxCents,
        taxable: line.taxable,
        costCents: line.costCents,
        sortOrder: line.sortOrder,
      });
    }
    const entries = new Map((await t.db.select().from(timeEntries)).map((row) => [row.stId, row]));
    for (const entry of data.timeEntries) {
      const got = entries.get(entry.stId ?? "");
      expect(got?.startedAt.toISOString()).toBe(entry.startedAt.toISOString());
      expect(got?.endedAt?.toISOString()).toBe(entry.endedAt?.toISOString());
      expect(got?.kind).toBe(entry.kind);
    }
  });

  it("turns line costs and payment fees into job costs like the demo data", async () => {
    const demoCost = (source: "invoice_line" | "payment") =>
      data.jobCosts
        .filter((c) => c.source === source)
        .reduce((total, c) => total + c.amountCents, 0);
    const ours = async (source: "invoice_line" | "payment") => {
      const [row] = await t.db
        .select({ total: sum(jobCosts.amountCents).mapWith(Number), n: count() })
        .from(jobCosts)
        .where(and(eq(jobCosts.source, source), isNull(jobCosts.deletedAt)));
      return row;
    };
    expect(await ours("invoice_line")).toEqual({
      total: demoCost("invoice_line"),
      n: data.jobCosts.filter((c) => c.source === "invoice_line").length,
    });
    expect(await ours("payment")).toEqual({
      total: demoCost("payment"),
      n: data.jobCosts.filter((c) => c.source === "payment").length,
    });
    // Each keeps a ServiceTitan key made from its line or payment.
    expect(await t.db.$count(jobCosts, isNull(jobCosts.stId))).toBe(0);
    const [feeCost] = await t.db
      .select({ stId: jobCosts.stId, paymentStId: payments.stId })
      .from(jobCosts)
      .innerJoin(payments, eq(sql`${payments.id}::text`, jobCosts.sourceId))
      .where(eq(jobCosts.source, "payment"))
      .limit(1);
    expect(feeCost?.stId).toBe(`${feeCost?.paymentStId}/fee`);
  });

  it.each(REPORT_TYPES)(
    "%s totals match ServiceTitan's summary per business unit and year",
    async (type) => {
      for (const map of [first, again]) {
        const comparison = await compareWithSummary({
          db: t.db,
          batchId: result(map, type).batchId,
          summary: fixtures.summary.reports[type],
        });
        expect(comparison.rows.filter((row) => row.status !== "match")).toEqual([]);
        expect(comparison.matches).toBe(true);
        expect(comparison.rows.length).toBeGreaterThan(0);
      }
    },
  );

  it("totals add up to the demo summary to the cent", async () => {
    const dollars = (type: ReportType) =>
      result(first, type)
        .totals.filter((row) => row.metric === "dollars")
        .reduce((total, row) => total + row.ours, 0);
    expect(dollars("invoices")).toBe(demo.totals.invoiceTotalCents);
    expect(dollars("payments")).toBe(demo.totals.paymentsCents);
    const years = new Set(result(first, "invoices").totals.map((row) => row.year));
    expect([...years].sort()).toEqual([2025, 2026]);
    // Recomputing gives the same numbers and keeps the summary next to them.
    const batchId = result(first, "invoices").batchId;
    const recomputed = await computeTotals({ db: t.db, batchId });
    expect(recomputed.every((row) => row.diff === 0)).toBe(true);
  });

  it("flags a summary that disagrees", async () => {
    const batchId = result(first, "invoices").batchId;
    const [firstLine, ...rest] = fixtures.summary.reports.invoices;
    if (!firstLine) throw new Error("empty summary");
    const comparison = await compareWithSummary({
      db: t.db,
      batchId,
      summary: [{ ...firstLine, total: "$1.00", count: (firstLine.count ?? 0) + 1 }, ...rest],
    });
    expect(comparison.matches).toBe(false);
    const differs = comparison.rows.filter((row) => row.status === "differs");
    expect(differs.map((row) => row.metric).sort()).toEqual(["count", "dollars"]);
    expect(differs.find((row) => row.metric === "count")?.diff).toBe(-1);
    // Putting the right summary back clears the difference.
    const fixed = await compareWithSummary({
      db: t.db,
      batchId,
      summary: fixtures.summary.reports.invoices,
    });
    expect(fixed.matches).toBe(true);
  });

  it("keeps every raw row unchanged, with the batch's file details", async () => {
    for (const type of REPORT_TYPES) {
      const r = result(first, type);
      const [batch] = await t.db
        .select()
        .from(stImportBatches)
        .where(eq(stImportBatches.id, r.batchId));
      expect(batch).toMatchObject({
        reportType: type,
        fileName: DEMO_FILE_NAMES[type],
        uploadedBy: OFFICE_USER_ID,
        status: "imported",
        fileSha256: r.fileSha256,
        storageKey: `st-imports/${r.fileSha256}.csv`,
        rowsRead: r.rowsRead,
        rowsInserted: r.inserted,
      });
      const raw = await t.db
        .select({
          rowNumber: stImportRows.rowNumber,
          payload: stImportRows.payload,
          result: stImportRows.result,
          stId: stImportRows.stId,
          targetId: stImportRows.targetId,
        })
        .from(stImportRows)
        .where(eq(stImportRows.batchId, r.batchId))
        .orderBy(asc(stImportRows.rowNumber));
      const records = parseCsv(fixtures.files[type]).records;
      expect(raw.map((row) => ({ rowNumber: row.rowNumber, payload: row.payload }))).toEqual(
        records.map((record) => ({ rowNumber: record.rowNumber, payload: record.cells })),
      );
      expect(raw.every((row) => row.result === "inserted" && row.stId && row.targetId)).toBe(true);
    }
  });

  it("audits every imported record and nothing on a re-import", async () => {
    const reason = (r: ImportResult) => `%(batch ${r.batchId})%`;
    const audited = async (r: ImportResult) =>
      t.db.$count(auditLog, sql`${auditLog.reason} like ${reason(r)}`);
    expect(await audited(result(first, "invoices"))).toBeGreaterThan(data.invoiceLines.length);
    for (const type of REPORT_TYPES) expect(await audited(result(again, type))).toBe(0);
    const [entry] = await t.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.tableName, "payments"), eq(auditLog.action, "import")))
      .limit(1);
    expect(entry).toMatchObject({ userId: OFFICE_USER_ID, before: null });
    expect(entry?.reason).toMatch(
      /^ServiceTitan payments import payments\.csv \(batch .+\) row \d+$/,
    );
  });
});
