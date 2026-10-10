import { z } from "zod";

/** Shared building blocks for request and response schemas. */

/** One of a fixed list of values, with a message that lists them. */
export function oneOfSchema<const T extends readonly [string, ...string[]]>(values: T) {
  return z.enum(values, { error: `Must be one of: ${values.join(", ")}` });
}

/** Integer cents. Money is never a float (CLAUDE.md rule 1). */
export const centsSchema = z.int();

/** A business-local calendar day, 'YYYY-MM-DD' (America/New_York). */
export const localDateSchema = z.iso.date({ error: "Enter a real date like 2026-10-09" });

/** An instant as an ISO 8601 string with offset, e.g. 2026-10-09T14:03:00.000Z. */
export const instantSchema = z.iso.datetime({ offset: true });

/** Any Postgres uuid (8-4-4-4-12 hex); imported ids need not be RFC 4122 v4. */
export const uuidSchema = z.guid({ error: "Must be a valid id" });

/** `:id` route parameters for uuid-keyed rows. */
export const idParamSchema = z.object({ id: uuidSchema });

/**
 * Pagination for list endpoints: 1-based `page`, `pageSize` up to 100.
 * Query strings arrive as text, so both are coerced.
 */
export const MAX_PAGE_SIZE = 100;
export const pageQuerySchema = z.object({
  page: z.coerce
    .number({ error: "Must be a whole number" })
    .int({ error: "Must be a whole number" })
    .min(1, { error: "Must be 1 or more" })
    .max(10_000, { error: "Must be 10000 or less" })
    .default(1),
  pageSize: z.coerce
    .number({ error: "Must be a whole number" })
    .int({ error: "Must be a whole number" })
    .min(1, { error: "Must be 1 or more" })
    .max(MAX_PAGE_SIZE, { error: `Must be ${MAX_PAGE_SIZE} or less` })
    .default(25),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;

/** A page of `item`: `total` counts every match, not just this page. */
export function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    page: z.int().min(1),
    pageSize: z.int().min(1),
    total: z.int().min(0),
  });
}

/**
 * An optional free-text search: trimmed, inner whitespace collapsed, empty
 * means "no search".
 */
export const searchTextSchema = z
  .string()
  .max(100, { error: "Must be 100 characters or less" })
  .transform((s) => s.trim().replace(/\s+/g, " "))
  .optional()
  .transform((s) => (s ? s : undefined));

/** "true"/"false" (also 1/0, yes/no, on/off) in a query string. */
export const queryBooleanSchema = z.stringbool({ error: "Must be true or false" });

/**
 * Phone numbers are stored as E.164 (+12525550123) so caller-ID lookups
 * match. Accepts common US formats ("(252) 555-0123", "252.555.0123",
 * "1 252 555 0123") and international numbers written with a leading "+".
 * Returns undefined when the text is not a phone number.
 */
export function normalizePhone(input: string): string | undefined {
  const trimmed = input.trim();
  if (!/^\+?[\d\s().-]+$/.test(trimmed)) return undefined;
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) {
    return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : undefined;
  }
  if (digits.length === 10 && /^[2-9]/.test(digits)) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1") && /^[2-9]/.test(digits.slice(1))) {
    return `+${digits}`;
  }
  return undefined;
}

export const phoneInputSchema = z.string().transform((value, ctx) => {
  const phone = normalizePhone(value);
  if (!phone) {
    ctx.addIssue({
      code: "custom",
      message: "Enter a 10-digit US phone number, or an international number starting with +",
    });
    return z.NEVER;
  }
  return phone;
});
