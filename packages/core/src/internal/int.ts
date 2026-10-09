/**
 * Integer helpers shared by every module. Nothing here uses floating-point math on money:
 * multiplication and division go through BigInt so intermediate products can't lose precision.
 */

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE = -MAX_SAFE;

/** Throws unless `value` is a safe integer (no fractions, no NaN, no Infinity). */
export function assertInt(value: number, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new RangeError(`${name} must be a whole number, got ${String(value)}`);
  }
  // `+ 0` turns -0 into 0 so it never leaks into output.
  return value + 0;
}

/** Throws unless `value` is a safe integer that is zero or more. */
export function assertNonNegativeInt(value: number, name: string): number {
  assertInt(value, name);
  if (value < 0) {
    throw new RangeError(`${name} can't be negative, got ${value}`);
  }
  return value + 0;
}

/** Throws unless `value` is a non-empty string. */
export function assertText(value: string, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${name} is required`);
  }
  return value;
}

/** Converts a BigInt back to a number, refusing anything outside the safe-integer range. */
export function toSafeNumber(value: bigint, name: string): number {
  if (value > MAX_SAFE || value < MIN_SAFE) {
    throw new RangeError(`${name} is too large to handle safely`);
  }
  return Number(value) + 0;
}

/**
 * Integer division rounded half-up on the magnitude, i.e. half away from zero:
 * 2.5 -> 3, -2.5 -> -3, 2.4 -> 2, -2.4 -> -2.
 */
export function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) {
    throw new RangeError("Division by zero");
  }
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  let quotient = n / d;
  const remainder = n % d;
  if (remainder * 2n >= d) {
    quotient += 1n;
  }
  return negative ? -quotient : quotient;
}

/** Ceiling division for non-negative operands. */
export function divCeil(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n || numerator < 0n) {
    throw new RangeError("divCeil expects a non-negative numerator and a positive denominator");
  }
  return (numerator + denominator - 1n) / denominator;
}

/** Reads `items[index]`, throwing instead of returning undefined. */
export function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new RangeError(`Index ${index} is out of range`);
  }
  return item;
}
