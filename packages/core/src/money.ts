/**
 * Money is always a whole number of cents; rates are basis points.
 * Rounding is half-up on the magnitude (half away from zero), applied once per line.
 * Totals are sums of already-rounded lines.
 */

import { assertInt, assertNonNegativeInt, at, divRoundHalfUp, toSafeNumber } from "./internal/int";

/** A whole number of US cents. Never a float. */
export type Cents = number;

/** Basis points: 10_000 bps = 100%, 1_000 bps = 10%. */
export type Bps = number;

/** 100% in basis points. */
export const BPS_SCALE = 10_000;

/** Throws unless `value` is a whole number of cents; returns it (with -0 normalized to 0). */
export function assertCents(value: number, name = "amount"): Cents {
  return assertInt(value, `${name} (cents)`);
}

/** Throws unless `value` is a whole number of basis points; returns it. */
export function assertBps(value: number, name = "rate"): Bps {
  return assertInt(value, `${name} (bps)`);
}

/** True when `value` is a safe whole number, the only valid shape for cents. */
export function isCents(value: unknown): value is Cents {
  return typeof value === "number" && Number.isSafeInteger(value);
}

/**
 * `a × b ÷ divisor`, computed exactly in integers and rounded half-up (half away from zero).
 * The building block for every rate, prorate and time-based money calculation.
 */
export function mulDivHalfUp(a: number, b: number, divisor: number): number {
  assertInt(a, "a");
  assertInt(b, "b");
  assertInt(divisor, "divisor");
  return toSafeNumber(divRoundHalfUp(BigInt(a) * BigInt(b), BigInt(divisor)), "result");
}

/**
 * Applies a basis-point rate to an amount of cents, rounding half-up
 * (half away from zero for negative amounts). `applyBps(62_000, 1_000)` is 6_200.
 */
export function applyBps(cents: Cents, bps: Bps): Cents {
  assertCents(cents, "cents");
  assertBps(bps, "bps");
  return toSafeNumber(divRoundHalfUp(BigInt(cents) * BigInt(bps), 10_000n), "applyBps result");
}

/** Adds amounts of cents, validating every one and the total. */
export function sumCents(values: readonly Cents[]): Cents {
  let total = 0n;
  values.forEach((value, index) => {
    assertCents(value, `values[${index}]`);
    total += BigInt(value);
  });
  return toSafeNumber(total, "sum");
}

/**
 * Splits `totalCents` in proportion to `weights` (whole numbers, zero or more) using the
 * largest-remainder method, so the parts always add up exactly to the total.
 * Leftover cents go to the largest remainders; ties go to the earlier entry.
 * A negative total is split by magnitude and then negated, so the split is symmetric.
 */
export function prorate(totalCents: Cents, weights: readonly number[]): Cents[] {
  assertCents(totalCents, "totalCents");
  if (weights.length === 0) {
    throw new RangeError("prorate needs at least one weight");
  }
  const big = weights.map((weight, index) =>
    BigInt(assertNonNegativeInt(weight, `weights[${index}]`)),
  );
  const weightSum = big.reduce((sum, weight) => sum + weight, 0n);
  if (weightSum === 0n) {
    throw new RangeError("prorate needs at least one weight above zero");
  }
  const negative = totalCents < 0;
  const magnitude = BigInt(Math.abs(totalCents));
  const shares = big.map((weight) => (magnitude * weight) / weightSum);
  const remainders = big.map((weight) => (magnitude * weight) % weightSum);
  let leftover = magnitude - shares.reduce((sum, share) => sum + share, 0n);

  const order = big.map((_, index) => index);
  order.sort((left, right) => {
    const a = at(remainders, left);
    const b = at(remainders, right);
    if (a === b) return left - right;
    return a > b ? -1 : 1;
  });
  for (const index of order) {
    if (leftover === 0n) break;
    shares[index] = at(shares, index) + 1n;
    leftover -= 1n;
  }
  return shares.map((share) => toSafeNumber(negative ? -share : share, "prorate share"));
}

const MONEY_PATTERN =
  /^(?<sign1>[-+]?)\s*(?<dollar>\$?)\s*(?<sign2>[-+]?)(?<whole>\d{1,3}(?:,\d{3})+|\d*)(?:\.(?<fraction>\d*))?$/;

export type ParseMoneyOptions = {
  /**
   * When true, digits past the cents place are rounded half-up instead of rejected
   * ("12.345" -> 1235). Off by default so unexpected precision is never silently dropped.
   */
  roundSubCents?: boolean;
};

/**
 * Parses a money string to integer cents without using floating-point math.
 * Accepts "$1,234.50", "1234.5", "-12.30", "-$12.30", "$-12.30", "(12.30)" and "($12.30)".
 * Rejects anything else (letters, bad comma groups, two signs, exponents, empty strings,
 * and digits past the cents place unless `roundSubCents` is set).
 */
export function parseMoney(input: string, options: ParseMoneyOptions = {}): Cents {
  if (typeof input !== "string") {
    throw new TypeError("parseMoney expects a string");
  }
  let text = input.trim();
  let parenthesized = false;
  if (text.startsWith("(") && text.endsWith(")")) {
    parenthesized = true;
    text = text.slice(1, -1).trim();
  }
  const match = MONEY_PATTERN.exec(text);
  const groups = match?.groups;
  if (!groups) {
    throw new RangeError(`Not a money amount: "${input}"`);
  }
  const sign1 = groups.sign1 ?? "";
  const sign2 = groups.sign2 ?? "";
  const dollar = groups.dollar ?? "";
  const whole = (groups.whole ?? "").replaceAll(",", "");
  const fraction = groups.fraction;

  if (sign1 !== "" && sign2 !== "") {
    throw new RangeError(`Not a money amount (two signs): "${input}"`);
  }
  if (sign2 !== "" && dollar === "") {
    throw new RangeError(`Not a money amount: "${input}"`);
  }
  const sign = sign1 || sign2;
  if (parenthesized && sign !== "") {
    throw new RangeError(`Not a money amount (parentheses and a sign): "${input}"`);
  }
  if (fraction === "") {
    throw new RangeError(`Not a money amount (nothing after the decimal point): "${input}"`);
  }
  if (whole === "" && fraction === undefined) {
    throw new RangeError(`Not a money amount (no digits): "${input}"`);
  }

  const digits = fraction ?? "";
  let cents = BigInt(whole === "" ? "0" : whole) * 100n + BigInt(digits.slice(0, 2).padEnd(2, "0"));
  const extra = digits.slice(2);
  if (/[1-9]/.test(extra)) {
    if (!options.roundSubCents) {
      throw new RangeError(`Money amount has fractions of a cent: "${input}"`);
    }
    // Half-up on a decimal string: round up when the first dropped digit is 5 or more.
    if (extra.charCodeAt(0) >= "5".charCodeAt(0)) {
      cents += 1n;
    }
  }
  const negative = parenthesized || sign === "-";
  return toSafeNumber(negative ? -cents : cents, `"${input}"`);
}

/**
 * Formats cents as dollars: 123_450 -> "$1,234.50", -1_230 -> "-$12.30".
 * Uses integer math only.
 */
export function formatCents(cents: Cents): string {
  assertCents(cents, "cents");
  const negative = cents < 0;
  const magnitude = Math.abs(cents);
  const remainder = magnitude % 100;
  const dollars = (magnitude - remainder) / 100;
  const grouped = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}$${grouped}.${String(remainder).padStart(2, "0")}`;
}

/** Formats basis points as a percentage: 1_000 -> "10%", 1_250 -> "12.5%", 8_444 -> "84.44%". */
export function formatBps(bps: Bps): string {
  assertBps(bps, "bps");
  const negative = bps < 0;
  const magnitude = Math.abs(bps);
  const remainder = magnitude % 100;
  const whole = (magnitude - remainder) / 100;
  const fraction =
    remainder === 0 ? "" : `.${String(remainder).padStart(2, "0").replace(/0$/, "")}`;
  return `${negative ? "-" : ""}${whole}${fraction}%`;
}

/** Formats whole minutes as hours and minutes: 120 -> "2h", 90 -> "1h 30m", 45 -> "45m". */
export function formatMinutes(minutes: number): string {
  assertInt(minutes, "minutes");
  const negative = minutes < 0;
  const magnitude = Math.abs(minutes);
  const mins = magnitude % 60;
  const hours = (magnitude - mins) / 60;
  let text: string;
  if (hours === 0) text = `${mins}m`;
  else if (mins === 0) text = `${hours}h`;
  else text = `${hours}h ${mins}m`;
  return negative ? `-${text}` : text;
}
