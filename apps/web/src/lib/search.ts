/** Helpers for reading URL search params (they arrive as unknown). */

export function searchText(value: unknown, max = 100): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const text = String(value).trim().slice(0, max);
  return text ? text : undefined;
}

export function searchPage(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isInteger(n) && n > 1 && n <= 10_000 ? n : undefined;
}

export function searchOneOf<T extends string>(
  value: unknown,
  options: readonly T[],
): T | undefined {
  return typeof value === "string" && (options as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

export function searchFlag(value: unknown): boolean | undefined {
  return value === true || value === "true" ? true : undefined;
}
