import { describe, expect, it } from "vitest";
import { CsvParseError, parseCsv, toCsv } from "../src";

describe("parseCsv", () => {
  it("keeps cells exactly as read, keyed by header, with spreadsheet row numbers", () => {
    const text =
      '﻿Customer ID,Customer Name,Notes\r\n C-1 ,"Smith, Ann","line one\nline two"\r\n\r\nC-2,Bob,""\r\n';
    const csv = parseCsv(text);
    expect(csv.headers).toEqual(["Customer ID", "Customer Name", "Notes"]);
    expect(csv.headerRowNumber).toBe(1);
    expect(csv.records).toEqual([
      {
        rowNumber: 2,
        cells: {
          "Customer ID": " C-1 ",
          "Customer Name": "Smith, Ann",
          Notes: "line one\nline two",
        },
        cellCount: 3,
      },
      {
        rowNumber: 4,
        cells: { "Customer ID": "C-2", "Customer Name": "Bob", Notes: "" },
        cellCount: 3,
      },
    ]);
  });

  it("skips a title and date-range preamble above the header", () => {
    const text =
      "Invoice Report\nDate Range: 1/1/2025 - 12/31/2025\n\nInvoice #,Invoice Date,Total\n1001,1/2/2025,$10.00\n";
    const csv = parseCsv(text);
    expect(csv.headerRowNumber).toBe(4);
    expect(csv.headers).toEqual(["Invoice #", "Invoice Date", "Total"]);
    expect(csv.records[0]?.rowNumber).toBe(5);
  });

  it("names duplicate, blank and extra columns", () => {
    const csv = parseCsv("Phone,Phone,\n1,2,3,4\n");
    expect(csv.headers).toEqual(["Phone", "Phone (2)", "Column 3"]);
    expect(csv.records[0]?.cells).toEqual({
      Phone: "1",
      "Phone (2)": "2",
      "Column 3": "3",
      "Column 4": "4",
    });
    expect(csv.records[0]?.cellCount).toBe(4);
  });

  it("explains files that aren't CSV", () => {
    expect(() => parseCsv('a,b\n"unclosed,1\n')).toThrow(CsvParseError);
    expect(() => parseCsv("\n\n")).toThrow("The file has no rows.");
  });

  it("round-trips through toCsv", () => {
    const rows = [
      ["1", 'He said "hi"', "a,b", " padded "],
      ["2", "multi\nline", "", "x"],
    ];
    const csv = parseCsv(toCsv(["A", "B", "C", "D"], rows));
    expect(csv.records.map((r) => Object.values(r.cells))).toEqual(rows);
  });
});
