import { parseMoney } from "@dwrg/core";
import { describe, expect, it } from "vitest";
import {
  customersMapping,
  formatUsDateTime,
  invoicesMapping,
  lookupValue,
  PAYMENT_METHOD_NAMES,
  parseInstant,
  parseLocalDate,
  pricebookMapping,
  RowReader,
} from "../src";

/** A reader over one row of the invoices mapping, with every field's usual header. */
function invoiceCells(cells: Record<string, string>) {
  const columns = Object.fromEntries(
    Object.entries(invoicesMapping.fields).map(([field, spec]) => [field, spec.headers[0]]),
  );
  return new RowReader(invoicesMapping, columns, cells);
}

describe("money", () => {
  it('parses "$1,234.50" to 123450 cents', () => {
    expect(parseMoney("$1,234.50")).toBe(123_450);
    const r = invoiceCells({ Total: "$1,234.50" });
    expect(r.money("total")).toBe(123_450);
    expect(r.ok).toBe(true);
  });

  it("reads negatives, parentheses and plain numbers without floating point", () => {
    const r = invoiceCells({ Total: "(12.30)", Subtotal: "-$0.07", Tax: "1234.5", Discount: "" });
    expect(r.money("total")).toBe(-1230);
    expect(r.money("subtotal")).toBe(-7);
    expect(r.money("tax")).toBe(123_450);
    expect(r.money("discount")).toBeNull();
    expect(r.money("balance")).toBeNull();
  });

  it("rejects fractions of a cent and junk with the column name", () => {
    const r = invoiceCells({ Total: "$12.345", Subtotal: "12.3.4" });
    r.money("total");
    r.money("subtotal");
    expect(r.issues.map((i) => i.message)).toEqual([
      'Total: "$12.345" is not a money amount like $1,234.50.',
      'Subtotal: "12.3.4" is not a money amount like $1,234.50.',
    ]);
    expect(r.issues[0]?.column).toBe("Total");
  });

  it("says when a required value is blank or its column is missing", () => {
    const columns = { total: "Total" };
    const r = new RowReader(invoicesMapping, columns, { Total: "  " });
    expect(r.requiredMoney("total")).toBe(0);
    expect(r.requiredMoney("balance")).toBe(0);
    expect(r.issues.map((i) => i.message)).toEqual([
      "Total is blank.",
      "The file has no Balance column.",
    ]);
  });
});

describe("dates and times (America/New_York)", () => {
  it("reads US and ISO dates and rejects impossible ones", () => {
    expect(parseLocalDate("10/6/2025")).toBe("2025-10-06");
    expect(parseLocalDate("01/09/2026")).toBe("2026-01-09");
    expect(parseLocalDate("2026-01-09")).toBe("2026-01-09");
    expect(parseLocalDate("10/6/2025 8:15 AM")).toBe("2025-10-06");
    expect(parseLocalDate("2/29/2025")).toBeNull();
    expect(parseLocalDate("13/1/2025")).toBeNull();
    expect(parseLocalDate("10/6/25")).toBeNull();
  });

  it("reads local wall-clock times in standard and daylight time", () => {
    expect(parseInstant("11/17/2025 9:41 AM")?.toISOString()).toBe("2025-11-17T14:41:00.000Z");
    expect(parseInstant("7/1/2025 2:30 PM")?.toISOString()).toBe("2025-07-01T18:30:00.000Z");
    expect(parseInstant("7/1/2025 12:05 AM")?.toISOString()).toBe("2025-07-01T04:05:00.000Z");
    expect(parseInstant("2025-07-01 14:30:15")?.toISOString()).toBe("2025-07-01T18:30:15.000Z");
    expect(parseInstant("7/1/2025")?.toISOString()).toBe("2025-07-01T04:00:00.000Z");
    expect(parseInstant("2025-07-01T18:30:00Z")?.toISOString()).toBe("2025-07-01T18:30:00.000Z");
    expect(parseInstant("7/1/2025 13:00 PM")).toBeNull();
    expect(parseInstant("yesterday")).toBeNull();
  });

  it("handles the daylight-saving changes", () => {
    // Fall back: 1:30 AM happens twice; the first (daylight time) is used.
    expect(parseInstant("11/2/2025 1:30 AM")?.toISOString()).toBe("2025-11-02T05:30:00.000Z");
    // Spring forward: 2:30 AM doesn't exist; it moves forward to 3:30 AM daylight time.
    expect(parseInstant("3/8/2026 2:30 AM")?.toISOString()).toBe("2026-03-08T07:30:00.000Z");
  });

  it("formats instants the way it reads them", () => {
    for (const iso of [
      "2025-11-17T14:41:00.000Z",
      "2025-07-01T18:30:15.000Z",
      "2026-01-01T05:00:00.000Z",
    ]) {
      const text = formatUsDateTime(new Date(iso));
      expect(parseInstant(text)?.toISOString()).toBe(iso);
    }
    expect(formatUsDateTime(new Date("2025-11-17T14:41:00Z"))).toBe("11/17/2025 9:41 AM");
  });
});

describe("other cells", () => {
  it("normalizes US phones to E.164", () => {
    const read = (value: string) => {
      const r = new RowReader(customersMapping, { contactPhone: "Phone" }, { Phone: value });
      return { value: r.phone("contactPhone"), issues: r.issues };
    };
    expect(read("(252) 555-0123").value).toBe("+12525550123");
    expect(read("1-252-555-0123").value).toBe("+12525550123");
    expect(read("+1 252.555.0123").value).toBe("+12525550123");
    expect(read("555-0123").issues[0]?.message).toBe(
      'Phone: "555-0123" is not a 10-digit US phone number.',
    );
  });

  it("reads exact quantities and computes line money half-up", () => {
    const r = invoiceCells({ Quantity: "1,000.5", "Line #": "3" });
    expect(r.quantity("quantity")).toEqual({ text: "1000.500", milli: 1_000_500 });
    expect(r.int("lineNumber", 0)).toBe(3);
    const bad = invoiceCells({ Quantity: "1.2345" });
    bad.quantity("quantity");
    expect(bad.issues[0]?.message).toContain("up to 3 decimal places");
  });

  it("turns decimal hours into whole minutes", () => {
    const columns = Object.fromEntries(
      Object.entries(pricebookMapping.fields).map(([field, spec]) => [field, spec.headers[0]]),
    );
    const read = (hours: string) =>
      new RowReader(pricebookMapping, columns, { Hours: hours }).hoursAsMinutes("hours");
    expect(read("1.5")).toBe(90);
    expect(read("0.8333")).toBe(50);
    expect(read("0.75")).toBe(45);
    expect(read("16")).toBe(960);
  });

  it("matches values by any label, ignoring case and punctuation", () => {
    expect(lookupValue(PAYMENT_METHOD_NAMES, "credit card")).toBe("card_keyed");
    expect(lookupValue(PAYMENT_METHOD_NAMES, "GREENSKY")).toBe("greensky");
    expect(lookupValue(PAYMENT_METHOD_NAMES, "e-check")).toBe("ach");
    expect(lookupValue(PAYMENT_METHOD_NAMES, "card_link")).toBe("card_link");
    expect(lookupValue(PAYMENT_METHOD_NAMES, "Bitcoin")).toBeNull();
  });

  it("rejects IDs a spreadsheet turned into scientific notation", () => {
    const r = invoiceCells({ "Invoice #": "1.23457E+11" });
    expect(r.id("invoiceNumber")).toBeNull();
    expect(r.issues[0]?.message).toContain("scientific notation");
  });
});
