/** Helpers for free-text search with LIKE / ILIKE. */

/** Escapes LIKE wildcards so user text matches literally (backslash is Postgres's default escape). */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** `%text%` with wildcards in `text` escaped. */
export function containsPattern(text: string): string {
  return `%${escapeLike(text)}%`;
}

/** At most this many words of a query are used. */
export const MAX_SEARCH_WORDS = 6;

export function searchWords(q: string): string[] {
  return q.split(" ").filter(Boolean).slice(0, MAX_SEARCH_WORDS);
}

/** Fewest digits that make a query a phone lookup ("0123", the last four). */
export const MIN_PHONE_DIGITS = 4;

/**
 * The digits of a query that looks like (part of) a phone number:
 * "(252) 555-0123", "252.555.0123", "+1 252 555 0123", "5550123".
 * Undefined for anything with letters, or fewer than four digits.
 */
export function phoneDigits(q: string): string | undefined {
  if (!/^[\d\s().+-]+$/.test(q)) return undefined;
  const digits = q.replace(/\D/g, "");
  return digits.length >= MIN_PHONE_DIGITS ? digits : undefined;
}
