import { z } from "zod";

/**
 * Every API error has the same JSON shape:
 *
 *   { "error": { "code": "validation_failed", "message": "...", "requestId": "...",
 *                "fields": { "email": ["Enter a valid email address"] } } }
 *
 * `fields` is present only for validation errors; keys are dotted paths into
 * the request (e.g. "skills.1"). `requestId` matches the X-Request-Id header
 * and the server logs. Messages never carry internals (stack traces, SQL).
 */

export const ERROR_CODES = [
  "validation_failed",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "payload_too_large",
  "unsupported_media_type",
  "rate_limited",
  "unavailable",
  "internal",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const fieldErrorsSchema = z.record(z.string(), z.array(z.string()));
export type FieldErrors = z.infer<typeof fieldErrorsSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    requestId: z.string().optional(),
    fields: fieldErrorsSchema.optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof apiErrorSchema>;

/** The parts of a Zod error this needs (classic and core errors both fit). */
export interface IssueList {
  issues: readonly {
    code?: string;
    path: readonly PropertyKey[];
    message: string;
    /** On "unrecognized_keys" issues: the unexpected field names. */
    keys?: readonly string[];
  }[];
}

export const UNKNOWN_FIELD_MESSAGE = "Unknown field";

/**
 * Groups Zod issues by dotted path ("" for the whole request). Unexpected
 * fields are reported under their own names ({ "isAdmin": ["Unknown field"] }).
 */
export function fieldErrorsFrom(error: IssueList): FieldErrors {
  const fields: FieldErrors = {};
  const add = (path: readonly PropertyKey[], message: string) => {
    const key = path.map(String).join(".");
    const list = fields[key] ?? [];
    if (!list.includes(message)) list.push(message);
    fields[key] = list;
  };
  for (const issue of error.issues) {
    if (issue.code === "unrecognized_keys" && issue.keys && issue.keys.length > 0) {
      for (const key of issue.keys) add([...issue.path, key], UNKNOWN_FIELD_MESSAGE);
    } else {
      add(issue.path, issue.message);
    }
  }
  return fields;
}
