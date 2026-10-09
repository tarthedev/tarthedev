import { describe, expect, it } from "vitest";
import {
  applyBps,
  assertCents,
  formatBps,
  formatCents,
  formatMinutes,
  mulDivHalfUp,
  parseMoney,
  prorate,
  sumCents,
} from "../src/index";

describe("parseMoney", () => {
  it.each([
    ["$1,234.50", 123_450],
    ["1234.5", 123_450],
    ["-12.30", -1_230],
    ["(12.30)", -1_230],
    ["($12.30)", -1_230],
    ["-$12.30", -1_230],
    ["$-12.30", -1_230],
    ["+5", 500],
    ["0", 0],
    ["-0.00", 0],
    [".5", 50],
    ["  $ 7.05  ", 705],
    ["$1,000,000", 100_000_000],
    ["12.300", 1_230],
    ["0.01", 1],
  ])("parses %s as %i cents", (input, expected) => {
    const result = parseMoney(input);
    expect(result).toBe(expected);
    expect(Object.is(result, -0)).toBe(false);
  });

  it.each([
    "",
    "   ",
    "$",
    "abc",
    "12abc",
    "1.2.3",
    "$$1",
    "--1",
    "-(1)",
    "(-1)",
    "1,23",
    "1234,567",
    "12.",
    "1e3",
    "NaN",
    "Infinity",
    "12.345",
    "1 000",
    "(12.30",
    "-+1",
    "99999999999999999",
  ])("rejects %j", (input) => {
    expect(() => parseMoney(input)).toThrow();
  });

  it("rounds fractions of a cent half-up only when asked", () => {
    expect(parseMoney("12.345", { roundSubCents: true })).toBe(1_235);
    expect(parseMoney("12.3449", { roundSubCents: true })).toBe(1_234);
    expect(parseMoney("-12.345", { roundSubCents: true })).toBe(-1_235);
    expect(parseMoney("(0.005)", { roundSubCents: true })).toBe(-1);
  });

  it("rejects non-strings", () => {
    expect(() => parseMoney(12 as unknown as string)).toThrow(TypeError);
  });
});

describe("formatCents", () => {
  it.each([
    [0, "$0.00"],
    [5, "$0.05"],
    [123_450, "$1,234.50"],
    [-1_230, "-$12.30"],
    [100_000_000, "$1,000,000.00"],
  ])("formats %i as %s", (cents, expected) => {
    expect(formatCents(cents)).toBe(expected);
  });

  it("round-trips with parseMoney", () => {
    for (const cents of [0, 1, -1, 99, 100, 123_456_789, -987_654]) {
      expect(parseMoney(formatCents(cents))).toBe(cents);
    }
  });

  it("refuses fractional cents", () => {
    expect(() => formatCents(1.5)).toThrow(RangeError);
  });
});

describe("applyBps rounds half-up, half away from zero for negatives", () => {
  it.each([
    [5, 1_000, 1], // 0.5 → 1
    [-5, 1_000, -1], // -0.5 → -1
    [4, 1_000, 0], // 0.4 → 0
    [-4, 1_000, 0], // -0.4 → 0
    [15, 5_000, 8], // 7.5 → 8
    [-15, 5_000, -8],
    [12_345, 500, 617], // 617.25
    [12_350, 500, 618], // 617.5
    [12_330, 500, 617], // 616.5 → 617
    [62_000, 1_000, 6_200],
    [2_100, 13_000, 2_730],
    [0, 1_400, 0],
  ])("applyBps(%i, %i) = %i", (cents, bps, expected) => {
    const result = applyBps(cents, bps);
    expect(result).toBe(expected);
    expect(Object.is(result, -0)).toBe(false);
  });

  it("stays exact for large amounts", () => {
    expect(applyBps(900_000_000_005, 5_000)).toBe(450_000_000_003);
  });

  it("rejects floats", () => {
    expect(() => applyBps(10.5, 1_000)).toThrow(RangeError);
    expect(() => applyBps(10, 10.5)).toThrow(RangeError);
  });
});

describe("mulDivHalfUp", () => {
  it("rounds exact halves away from zero", () => {
    expect(mulDivHalfUp(1, 1, 2)).toBe(1);
    expect(mulDivHalfUp(-1, 1, 2)).toBe(-1);
    expect(mulDivHalfUp(1, 1, 3)).toBe(0);
    expect(mulDivHalfUp(2, 1, 3)).toBe(1);
  });
  it("refuses division by zero", () => {
    expect(() => mulDivHalfUp(1, 1, 0)).toThrow(RangeError);
  });
});

describe("sumCents", () => {
  it("adds whole cents and rejects anything else", () => {
    expect(sumCents([])).toBe(0);
    expect(sumCents([1, -2, 300])).toBe(299);
    expect(() => sumCents([1, 0.1])).toThrow(RangeError);
    expect(() => sumCents([Number.MAX_SAFE_INTEGER, 1])).toThrow(RangeError);
  });
});

describe("prorate (largest remainder)", () => {
  it("gives leftover cents to the largest remainders, earlier entry on ties", () => {
    expect(prorate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(prorate(1, [1, 1])).toEqual([1, 0]);
    expect(prorate(5, [1, 2, 3])).toEqual([1, 2, 2]);
    expect(prorate(2, [1, 1, 1])).toEqual([1, 1, 0]);
  });

  it("splits negative totals symmetrically", () => {
    expect(prorate(-100, [1, 1, 1])).toEqual([-34, -33, -33]);
  });

  it("gives zero-weight entries nothing", () => {
    expect(prorate(10, [0, 1, 0])).toEqual([0, 10, 0]);
    expect(prorate(7, [0, 3, 3])).toEqual([0, 4, 3]);
  });

  it("always adds up to the total", () => {
    // Park-Miller generator: deterministic and stays within safe integers.
    let seed = 42;
    const next = () => {
      seed = (seed * 48_271) % 2_147_483_647;
      return seed;
    };
    for (let round = 0; round < 500; round += 1) {
      const total = (next() % 2_000_001) - 1_000_000;
      const count = (next() % 6) + 1;
      const weights = Array.from({ length: count }, () => next() % 500);
      if (!weights.some((w) => w > 0)) weights[0] = 1;
      const parts = prorate(total, weights);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
      parts.forEach((part) => {
        expect(Number.isSafeInteger(part)).toBe(true);
      });
    }
  });

  it("rejects bad weights", () => {
    expect(() => prorate(10, [])).toThrow(RangeError);
    expect(() => prorate(10, [0, 0])).toThrow(RangeError);
    expect(() => prorate(10, [-1, 2])).toThrow(RangeError);
    expect(() => prorate(10, [0.5, 2])).toThrow(RangeError);
    expect(() => prorate(10.5, [1])).toThrow(RangeError);
  });
});

describe("formatting helpers", () => {
  it("formats basis points", () => {
    expect(formatBps(1_000)).toBe("10%");
    expect(formatBps(1_250)).toBe("12.5%");
    expect(formatBps(8_444)).toBe("84.44%");
    expect(formatBps(5)).toBe("0.05%");
    expect(formatBps(13_000)).toBe("130%");
  });
  it("formats minutes", () => {
    expect(formatMinutes(120)).toBe("2h");
    expect(formatMinutes(90)).toBe("1h 30m");
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(0)).toBe("0m");
  });
  it("assertCents normalizes -0 and rejects NaN", () => {
    expect(Object.is(assertCents(-0), 0)).toBe(true);
    expect(() => assertCents(Number.NaN)).toThrow(RangeError);
  });
});
