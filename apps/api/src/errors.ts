import type { ApiErrorBody, ErrorCode, FieldErrors } from "@dwrg/shared";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv } from "./context";
import { serializeError } from "./logger";

/**
 * Errors a handler throws on purpose. The error handler turns them into the
 * shared JSON shape ({ error: { code, message, requestId, fields? } }).
 * Anything else becomes a 500 with a generic message; details go to the log
 * only, never to the client.
 */
export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: ErrorCode,
    message: string,
    readonly fields?: FieldErrors,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const unauthorized = (message = "Sign in to continue.") =>
  new ApiError(401, "unauthorized", message);

export const forbidden = (message = "You don't have access to this.") =>
  new ApiError(403, "forbidden", message);

export const notFound = (message = "Not found.") => new ApiError(404, "not_found", message);

export const conflict = (message: string, fields?: FieldErrors) =>
  new ApiError(409, "conflict", message, fields);

export const validationFailed = (fields: FieldErrors, message = "Check the highlighted fields.") =>
  new ApiError(400, "validation_failed", message, fields);

const STATUS_CODES: Partial<Record<number, ErrorCode>> = {
  400: "validation_failed",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  413: "payload_too_large",
  415: "unsupported_media_type",
  429: "rate_limited",
  503: "unavailable",
};

/** Messages for Hono's own errors, which may carry none (or a terse one). */
const STATUS_MESSAGES: Partial<Record<number, string>> = {
  401: "Sign in to continue.",
  403: "You don't have access to this.",
  404: "Not found.",
  413: "The request body is too large.",
  415: "Send the request body as JSON.",
  429: "Too many requests. Wait a minute and try again.",
};

export function errorBody(
  c: Context<AppEnv>,
  code: ErrorCode,
  message: string,
  fields?: FieldErrors,
): ApiErrorBody {
  const requestId = c.get("requestId");
  return {
    error: {
      code,
      message,
      ...(requestId ? { requestId } : {}),
      ...(fields ? { fields } : {}),
    },
  };
}

/** app.onError: the one place errors become responses. */
export function handleError(err: Error, c: Context<AppEnv>): Response {
  const log = c.get("log");
  if (err instanceof ApiError) {
    if (err.status >= 500) log?.error("request failed", { err: serializeError(err) });
    return c.json(errorBody(c, err.code, err.message, err.fields), err.status);
  }
  if (err instanceof HTTPException && err.status < 500) {
    // Hono's own client errors (malformed JSON, a cross-site form post, ...).
    const status = err.status as ContentfulStatusCode;
    const code = STATUS_CODES[status] ?? "validation_failed";
    const message = /^malformed json/i.test(err.message)
      ? "The request body isn't valid JSON."
      : (STATUS_MESSAGES[status] ?? (err.message || "Bad request."));
    return c.json(errorBody(c, code, message), status);
  }
  log?.error("unhandled error", { err: serializeError(err) });
  return c.json(
    errorBody(c, "internal", "Something went wrong on our side. Try again, or tell the office."),
    500,
  );
}

/** app.notFound */
export function handleNotFound(c: Context<AppEnv>): Response {
  return c.json(errorBody(c, "not_found", "No such endpoint."), 404);
}
