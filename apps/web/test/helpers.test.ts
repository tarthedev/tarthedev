import type { ImportTotal } from "@dwrg/shared";
import { describe, expect, it } from "vitest";
import { linesFrom, summaryRows } from "../src/features/imports/SummaryForm";
import { homePathFor, safeRedirect } from "../src/lib/auth";
import { searchFlag, searchOneOf, searchPage, searchText } from "../src/lib/search";

describe("where people land", () => {
  it("sends office roles to Customers and field roles to their iPad home", () => {
    expect(homePathFor("owner")).toBe("/customers");
    expect(homePathFor("manager")).toBe("/customers");
    expect(homePathFor("dispatcher_csr")).toBe("/customers");
    expect(homePathFor("tech")).toBe("/tech");
    expect(homePathFor("installer")).toBe("/tech");
  });

  it("only returns to paths inside the app after signing in", () => {
    expect(safeRedirect("/customers?q=smith")).toBe("/customers?q=smith");
    expect(safeRedirect("https://evil.example/")).toBeUndefined();
    expect(safeRedirect("//evil.example/")).toBeUndefined();
    expect(safeRedirect("/\\evil.example")).toBeUndefined();
    expect(safeRedirect("/login")).toBeUndefined();
    expect(safeRedirect("/login?redirect=/x")).toBeUndefined();
    expect(safeRedirect(42)).toBeUndefined();
  });
});

describe("URL search params", () => {
  it("reads only what the screen understands", () => {
    expect(searchText("  smith  ")).toBe("smith");
    expect(searchText("   ")).toBeUndefined();
    expect(searchText(2525550123)).toBe("2525550123");
    expect(searchPage("3")).toBe(3);
    expect(searchPage("1")).toBeUndefined();
    expect(searchPage("1.5")).toBeUndefined();
    expect(searchPage("-2")).toBeUndefined();
    expect(searchOneOf("commercial", ["residential", "commercial"] as const)).toBe("commercial");
    expect(searchOneOf("other", ["residential", "commercial"] as const)).toBeUndefined();
    expect(searchFlag("true")).toBe(true);
    expect(searchFlag("yes")).toBeUndefined();
  });
});

const total = (over: Partial<ImportTotal>): ImportTotal => ({
  businessUnitCode: "hvac_service",
  year: 2026,
  metric: "count",
  ours: 10,
  servicetitanSummary: null,
  diff: null,
  note: null,
  status: "not_in_summary",
  ...over,
});

describe("ServiceTitan summary entry", () => {
  it("makes one line per department and year, prefilled with what was entered", () => {
    const lines = linesFrom([
      total({ metric: "count", servicetitanSummary: 12, diff: -2, status: "differs" }),
      total({ metric: "dollars", ours: 123_456, servicetitanSummary: 123_456, diff: 0 }),
      total({ businessUnitCode: "none", year: 0, metric: "count" }),
    ]);
    expect(lines).toEqual([
      {
        key: "hvac_service|2026",
        businessUnit: "hvac_service",
        year: "2026",
        count: "12",
        total: "$1,234.56",
        added: false,
      },
      { key: "none|0", businessUnit: "none", year: "", count: "", total: "", added: false },
    ]);
  });

  it("sends dollars as typed (the server turns them into cents) and counts as numbers", () => {
    const { rows, problems } = summaryRows([
      {
        key: "a",
        businessUnit: "plumbing",
        year: "2025",
        count: "1,204",
        total: "$12,345.67",
        added: false,
      },
      { key: "b", businessUnit: "none", year: "", count: "", total: "", added: false },
      { key: "c", businessUnit: "none", year: "", count: "7", total: "", added: true },
    ]);
    expect(problems).toEqual({});
    expect(rows).toEqual([
      { businessUnit: "plumbing", year: 2025, count: 1204, total: "$12,345.67" },
      { businessUnit: null, year: null, count: 7 },
    ]);
  });

  it("points at lines it can't read instead of guessing", () => {
    const { rows, problems } = summaryRows([
      { key: "a", businessUnit: "plumbing", year: "2025", count: "12.5", total: "", added: false },
      {
        key: "b",
        businessUnit: "plumbing",
        year: "2025",
        count: "",
        total: "$1.234",
        added: false,
      },
      { key: "c", businessUnit: "none", year: "26", count: "3", total: "", added: true },
    ]);
    expect(rows).toEqual([]);
    expect(Object.keys(problems)).toEqual(["a", "b", "c"]);
    expect(problems.a).toMatch(/whole number/);
    expect(problems.b).toMatch(/\$12,345\.67/);
    expect(problems.c).toMatch(/four digits/);
  });
});
