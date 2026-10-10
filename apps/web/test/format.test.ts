import { describe, expect, it } from "vitest";
import {
  formatBytes,
  formatCents,
  formatDate,
  formatDuration,
  formatInstant,
  formatPhone,
  formatSigned,
  groupThousands,
  plural,
} from "../src/lib/format";

describe("formatCents (integer cents, no float math)", () => {
  it.each([
    [0, "$0.00"],
    [5, "$0.05"],
    [99, "$0.99"],
    [100, "$1.00"],
    [123_456, "$1,234.56"],
    [-500, "-$5.00"],
    [-1, "-$0.01"],
    [100_000_000_00, "$100,000,000.00"],
    // The largest safe integer still prints exactly (no rounding through dollars).
    [Number.MAX_SAFE_INTEGER, "$90,071,992,547,409.91"],
  ])("%d -> %s", (cents, text) => {
    expect(formatCents(cents)).toBe(text);
  });

  it("refuses anything that isn't whole cents", () => {
    expect(() => formatCents(12.5)).toThrow(/whole cents/);
    expect(() => formatCents(Number.NaN)).toThrow(/whole cents/);
  });
});

describe("other formats", () => {
  it("groups thousands and signs differences", () => {
    expect(groupThousands(1_234_567)).toBe("1,234,567");
    expect(groupThousands(-1200)).toBe("-1,200");
    expect(formatSigned(3)).toBe("+3");
    expect(formatSigned(-1200)).toBe("-1,200");
    expect(formatSigned(0)).toBe("0");
    expect(formatSigned(250, formatCents)).toBe("+$2.50");
  });

  it("shows calendar days without a time-zone shift", () => {
    expect(formatDate("2026-01-01")).toBe("Jan 1, 2026");
    expect(formatDate("2026-10-09")).toBe("Oct 9, 2026");
    expect(formatDate(null)).toBe("");
    expect(formatDate("soon")).toBe("soon");
  });

  it("shows instants in business time (America/New_York)", () => {
    // 03:30 UTC on Jan 1 is still Dec 31 in New York.
    expect(formatInstant("2026-01-01T03:30:00Z")).toBe("Dec 31, 2025, 10:30 PM");
    expect(formatInstant("2026-07-01T16:05:00Z")).toBe("Jul 1, 2026, 12:05 PM");
  });

  it("formats US phone numbers and leaves others alone", () => {
    expect(formatPhone("+12525550123")).toBe("(252) 555-0123");
    expect(formatPhone("+442071234567")).toBe("+442071234567");
    expect(formatPhone(null)).toBe("");
  });

  it("says sizes, counts and durations in words", () => {
    expect(formatBytes(900)).toBe("900 bytes");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(25 * 1024 * 1024)).toBe("25 MB");
    expect(plural(1, "location")).toBe("1 location");
    expect(plural(1200, "row")).toBe("1,200 rows");
    expect(formatDuration(4.9)).toBe("4 s");
    expect(formatDuration(125)).toBe("2 min 5 s");
    expect(formatDuration(3780)).toBe("1 h 3 min");
    expect(formatDuration(-3)).toBe("0 s");
  });
});
