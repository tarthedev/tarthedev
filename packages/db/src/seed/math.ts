/** Integer money math for the demo generator (CLAUDE.md rule 1). */

function assertInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be a safe integer, got ${value}`);
}

/** numerator / denominator rounded half-up, for non-negative integers. */
export function divRoundHalfUp(numerator: number, denominator: number): number {
  assertInteger("numerator", numerator);
  assertInteger("denominator", denominator);
  if (denominator <= 0) throw new Error("denominator must be positive");
  if (numerator < 0) throw new Error("numerator must be non-negative");
  return Math.floor((numerator * 2 + denominator) / (denominator * 2));
}

/** `cents` x `bps` / 10000, rounded half-up. */
export function applyBps(cents: number, bps: number): number {
  return divRoundHalfUp(cents * bps, 10_000);
}

/** Labor cost of `seconds` of work at `wageCentsPerHour` burdened by `burdenBps`. */
export function laborCostCents(
  seconds: number,
  wageCentsPerHour: number,
  burdenBps: number,
): number {
  return divRoundHalfUp(seconds * wageCentsPerHour * burdenBps, 3600 * 10_000);
}

export function sum(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

/** Rounds cents to whole dollars, half-up. */
export function roundToDollars(cents: number): number {
  return divRoundHalfUp(cents, 100) * 100;
}
