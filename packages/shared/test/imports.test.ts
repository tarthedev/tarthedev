import { describe, expect, it } from "vitest";
import {
  importFileNameSchema,
  importSummaryRequestSchema,
  importUploadOptionsSchema,
  isStReportType,
  ST_REPORT_LABELS,
  ST_REPORT_TYPES,
} from "../src";

describe("importFileNameSchema", () => {
  it.each([
    ["invoices.csv", "invoices.csv"],
    ["C:\\fakepath\\invoices.csv", "invoices.csv"],
    ["/home/office/Downloads/payments 2026.csv", "payments 2026.csv"],
    ["  spaced.csv  ", "spaced.csv"],
    ["tab\there.csv", "tabhere.csv"],
  ])("%j -> %j", (input, name) => {
    expect(importFileNameSchema.parse(input)).toBe(name);
  });

  it("caps the length and refuses an empty name", () => {
    expect(importFileNameSchema.parse(`${"a".repeat(300)}.csv`)).toHaveLength(200);
    expect(importFileNameSchema.safeParse("C:\\folder\\").success).toBe(false);
  });
});

describe("importUploadOptionsSchema", () => {
  it("takes a report type and a checksum, and nothing else", () => {
    expect(
      importUploadOptionsSchema.parse({ reportType: "invoices", sha256: "a".repeat(64) }),
    ).toEqual({ reportType: "invoices", sha256: "a".repeat(64) });
    expect(importUploadOptionsSchema.safeParse({ sha256: "ABC" }).success).toBe(false);
    expect(importUploadOptionsSchema.safeParse({ reportType: "trucks" }).success).toBe(false);
    expect(importUploadOptionsSchema.safeParse({ extra: "1" }).success).toBe(false);
  });
});

describe("importSummaryRequestSchema", () => {
  it("keeps dollars as text for the server to read into cents", () => {
    expect(
      importSummaryRequestSchema.parse({
        rows: [{ businessUnit: " HVAC Service ", year: 2026, count: 3, total: "$1,234.56" }],
      }),
    ).toEqual({
      rows: [{ businessUnit: "HVAC Service", year: 2026, count: 3, total: "$1,234.56" }],
    });
  });

  it("refuses fractional counts and unknown fields", () => {
    expect(importSummaryRequestSchema.safeParse({ rows: [{ count: 1.5 }] }).success).toBe(false);
    expect(importSummaryRequestSchema.safeParse({ rows: [{ cents: 1 }] }).success).toBe(false);
  });
});

describe("report types", () => {
  it("every type has a label", () => {
    for (const type of ST_REPORT_TYPES) {
      expect(isStReportType(type)).toBe(true);
      expect(ST_REPORT_LABELS[type].length).toBeGreaterThan(0);
    }
    expect(isStReportType("unknown")).toBe(false);
    expect(isStReportType(undefined)).toBe(false);
  });
});
