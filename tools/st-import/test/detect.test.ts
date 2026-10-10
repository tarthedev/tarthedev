import { describe, expect, it } from "vitest";
import {
  BILLING_STAGE_NAMES,
  BUSINESS_UNIT_NAMES,
  CUSTOMER_TYPE_NAMES,
  detectReportType,
  EQUIPMENT_KIND_NAMES,
  EQUIPMENT_STATUS_NAMES,
  INVOICE_STATUS_NAMES,
  JOB_PRIORITY_NAMES,
  JOB_STATUS_NAMES,
  MAPPINGS,
  MEMBERSHIP_STATUS_NAMES,
  matchColumns,
  normalizeLabel,
  PAYMENT_METHOD_NAMES,
  PRICEBOOK_KIND_NAMES,
  parseCsv,
  REPORT_TYPES,
  ROLE_NAMES,
  SKILL_NAMES,
  TIME_ENTRY_KIND_NAMES,
  type ValueSynonyms,
  YES_NO,
} from "../src";
import { readDemoFixtures } from "../src/demo";

describe("mapping config", () => {
  it.each(REPORT_TYPES)("%s: no header means two fields", (type) => {
    const owners = new Map<string, string>();
    for (const [field, spec] of Object.entries(MAPPINGS[type].fields)) {
      for (const header of spec.headers) {
        const label = normalizeLabel(header);
        expect(owners.get(label) ?? field, `"${header}" in ${type}`).toBe(field);
        owners.set(label, field);
      }
    }
  });

  it("no cell value means two of our values", () => {
    const tables: Record<string, ValueSynonyms<string>> = {
      BUSINESS_UNIT_NAMES,
      CUSTOMER_TYPE_NAMES,
      ROLE_NAMES,
      SKILL_NAMES,
      EQUIPMENT_KIND_NAMES,
      EQUIPMENT_STATUS_NAMES,
      MEMBERSHIP_STATUS_NAMES,
      PRICEBOOK_KIND_NAMES,
      JOB_STATUS_NAMES,
      JOB_PRIORITY_NAMES,
      INVOICE_STATUS_NAMES,
      BILLING_STAGE_NAMES,
      PAYMENT_METHOD_NAMES,
      TIME_ENTRY_KIND_NAMES,
      YES_NO,
    };
    for (const [name, table] of Object.entries(tables)) {
      const owners = new Map<string, string>();
      for (const [value, labels] of Object.entries(table)) {
        for (const label of [value, ...labels]) {
          const key = normalizeLabel(label);
          expect(owners.get(key) ?? value, `"${label}" in ${name}`).toBe(value);
          owners.set(key, value);
        }
      }
    }
  });
});

describe("detectReportType", () => {
  const fixtures = readDemoFixtures();

  it.each(REPORT_TYPES)("detects the demo %s export from its headers", (type) => {
    const { headers } = parseCsv(fixtures.files[type]);
    const result = detectReportType(headers);
    expect(result.reportType).toBe(type);
    expect(result.candidates[0]?.reportType).toBe(type);
    expect(result.candidates[0]?.scoreBps).toBe(10_000);
    expect(matchColumns(MAPPINGS[type], headers).unmatchedHeaders).toEqual([]);
  });

  it("matches other spellings of the same columns", () => {
    const result = detectReportType([
      "PAYMENT NUMBER",
      "invoice number",
      "Payment Method",
      "Payment Date",
      "Payment Amount",
    ]);
    expect(result.reportType).toBe("payments");
  });

  it("explains when the columns fit no report", () => {
    const result = detectReportType(["Name", "Favorite Color"]);
    expect(result.reportType).toBeNull();
    expect(result.reason).toContain("don't match any ServiceTitan report");
  });

  it("lists the missing required columns of each report type", () => {
    const result = detectReportType(["Invoice #", "Total"]);
    const invoices = result.candidates.find((c) => c.reportType === "invoices");
    expect(invoices?.missingRequired).toEqual([
      "Customer ID",
      "Business Unit",
      "Invoice Date",
      "Balance",
    ]);
  });
});
