import { parseMoney } from "@dwrg/core";
import { generateDemoData, summarizeDemoData } from "@dwrg/db/demo";
import { describe, expect, it } from "vitest";
import { parseCsv, REPORT_TYPES } from "../src";
import { buildDemoExports, DEMO_EXPORT_OPTIONS, readDemoFixtures } from "../src/demo";

describe("demo fixtures", () => {
  const data = generateDemoData(DEMO_EXPORT_OPTIONS);
  const built = buildDemoExports(data);
  const committed = readDemoFixtures();

  it.each(REPORT_TYPES)("committed %s.csv matches the generator (run demo-csvs if not)", (type) => {
    expect(committed.files[type]).toBe(built.files[type]);
  });

  it("committed summary.json matches the generator", () => {
    expect(committed.summary).toEqual(JSON.parse(JSON.stringify(built.summary)));
  });

  it("has one CSV row per demo record", () => {
    const rows = (type: (typeof REPORT_TYPES)[number]) =>
      parseCsv(built.files[type]).records.length;
    expect(rows("technicians")).toBe(data.employees.length);
    expect(rows("pricebook")).toBe(data.pricebookItems.length);
    expect(rows("equipment")).toBe(data.equipment.length);
    expect(rows("memberships")).toBe(data.memberships.length);
    expect(rows("payments")).toBe(data.payments.length);
    expect(rows("timesheets")).toBe(data.timeEntries.length);
    const jobsWithoutInvoice = data.jobs.filter(
      (job) => !data.invoices.some((invoice) => invoice.jobId === job.id),
    ).length;
    expect(rows("invoices")).toBe(data.invoiceLines.length + jobsWithoutInvoice);
  });

  it("summary totals agree with the demo data summary to the cent", () => {
    const demo = summarizeDemoData(data);
    const cents = (type: "invoices" | "payments" | "memberships") =>
      built.summary.reports[type].reduce((sum, row) => sum + parseMoney(row.total ?? "$0"), 0);
    expect(cents("invoices")).toBe(demo.totals.invoiceTotalCents);
    expect(cents("payments")).toBe(demo.totals.paymentsCents);
    expect(built.summary.demoTotals.invoiceTotalCents).toBe(demo.totals.invoiceTotalCents);
    const years = new Set(built.summary.reports.invoices.map((row) => row.year));
    expect([...years].sort()).toEqual([2025, 2026]);
  });
});
