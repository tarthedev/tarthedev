import type { FieldErrors } from "@dwrg/shared";
import { API_URL } from "./config";

/** Anything with a Zod-style `parse` (the @dwrg/shared response schemas). */
export interface Parser<T> {
  parse(data: unknown): T;
}

/**
 * A failed API call, in words people can act on. `status` 0 means the server
 * couldn't be reached. `fields` holds per-field messages from validation.
 */
export class ApiError extends Error {
  override name = "ApiError";

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: FieldErrors = {},
    readonly requestId?: string,
  ) {
    super(message);
  }
}

export const isUnauthorized = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 401;

export type QueryValue = string | number | boolean | null | undefined;

export interface ApiOptions<T> {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Sent as application/json. */
  json?: unknown;
  /** Sent as is (e.g. FormData for uploads). */
  body?: BodyInit;
  query?: Record<string, QueryValue>;
  /** Checks the response against its @dwrg/shared schema. */
  schema: Parser<T>;
  signal?: AbortSignal;
}

export function apiUrl(path: string, query?: Record<string, QueryValue>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const search = params.toString();
  return `${API_URL}${path}${search ? `?${search}` : ""}`;
}

const NETWORK_MESSAGE = "Can't reach the server. Check the connection and try again.";

/**
 * Calls the API with the session cookie. The response body is checked
 * against `schema`; error responses become ApiError with the server's message.
 */
export async function api<T>(path: string, options: ApiOptions<T>): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  let body = options.body;
  if (options.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.json);
  }
  let res: Response;
  try {
    res = await fetch(apiUrl(path, options.query), {
      method: options.method ?? (body === undefined ? "GET" : "POST"),
      headers,
      body,
      credentials: "include",
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0, "network", NETWORK_MESSAGE);
  }
  const data = await readJson(res);
  if (!res.ok) throw errorFrom(res, data);
  try {
    return options.schema.parse(data);
  } catch {
    throw new ApiError(
      res.status,
      "unexpected_response",
      "The server sent something this screen doesn't understand. Reload the app.",
    );
  }
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const STATUS_MESSAGES: Record<number, string> = {
  401: "Sign in to continue.",
  403: "You don't have access to this.",
  404: "Not found.",
  413: "That file is too large.",
  429: "Too many tries. Wait a minute and try again.",
  502: "The server is restarting. Try again in a minute.",
  503: "The server is busy or down. Try again in a minute.",
  504: "The server took too long to answer. Try again.",
};

/** Our API's { error: { code, message, fields } } or Better Auth's { code, message }. */
function errorFrom(res: Response, data: unknown): ApiError {
  const requestId = res.headers.get("X-Request-Id") ?? undefined;
  const fallback =
    STATUS_MESSAGES[res.status] ??
    (res.status >= 500 ? "Something went wrong on our side. Try again." : "That didn't work.");
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    const inner = (
      record.error && typeof record.error === "object" ? record.error : record
    ) as Record<string, unknown>;
    const message = typeof inner.message === "string" && inner.message ? inner.message : fallback;
    const code = typeof inner.code === "string" ? inner.code : `http_${res.status}`;
    const fields = isFieldErrors(inner.fields) ? inner.fields : {};
    return new ApiError(res.status, code, message, fields, requestId);
  }
  return new ApiError(res.status, `http_${res.status}`, fallback, {}, requestId);
}

function isFieldErrors(value: unknown): value is FieldErrors {
  return (
    value !== null &&
    typeof value === "object" &&
    Object.values(value).every((list) => Array.isArray(list))
  );
}

/** A parser that accepts any body, for endpoints whose answer we don't read. */
export const anyBody: Parser<unknown> = { parse: (data) => data };

/** The message to show for any thrown error. */
export function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong. Try again.";
}
