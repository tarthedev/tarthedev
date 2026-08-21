import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";

import { UnauthorizedError, requireApiUser } from "@/lib/auth/guard";
import type { SessionUser } from "@/lib/auth/session";
import { BudgetExceededError } from "@/lib/ai/budget";
import { logger } from "@/lib/logger";

export interface ApiErrorBody {
  error: string;
  /** Actionable guidance — every error the user sees should say what to do. */
  detail?: string;
  code?: string;
  fields?: Record<string, string>;
}

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, init);
}

export function fail(status: number, body: ApiErrorBody, init?: ResponseInit): NextResponse {
  return NextResponse.json(body, { ...init, status });
}

/** Turns a Zod failure into per-field messages the form can render inline. */
function zodFields(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join(".") || "_";
    fields[path] ??= issue.message;
  }
  return fields;
}

type Handler<T> = (context: { user: SessionUser; request: Request }) => Promise<T>;

/**
 * Handlers may return a plain `Response` (a CSV download, an image) or any
 * JSON-serialisable value. Checking `Response` rather than `NextResponse` is
 * what keeps a streamed or custom-content-type reply from being wrapped in JSON.
 */
function toResponse(result: unknown): NextResponse | Response {
  return result instanceof Response ? result : NextResponse.json(result);
}

/**
 * Wraps a route handler with authentication and consistent error shaping so no
 * endpoint can accidentally ship an unauthenticated path or a bare
 * "Something went wrong".
 */
export function withAuth<T>(handler: Handler<T>) {
  return async (request: Request): Promise<Response> => {
    try {
      const user = await requireApiUser();
      const result = await handler({ user, request });
      return toResponse(result) as NextResponse;
    } catch (error) {
      return toErrorResponse(error, request);
    }
  };
}

export async function toErrorResponse(error: unknown, request?: Request): Promise<NextResponse> {
  if (error instanceof UnauthorizedError) {
    return fail(401, { error: "Sign in to continue.", code: "UNAUTHORIZED" });
  }
  if (error instanceof ZodError) {
    return fail(400, {
      error: "Some of the values sent were not valid.",
      code: "VALIDATION",
      fields: zodFields(error),
    });
  }
  if (error instanceof BudgetExceededError) {
    return fail(402, { error: error.message, code: "BUDGET_EXCEEDED" });
  }

  const message = error instanceof Error ? error.message : "Unexpected server error.";
  await logger.error({
    category: "api",
    message,
    meta: { url: request?.url, method: request?.method },
  });
  return fail(500, { error: message, code: "INTERNAL" });
}

/** Parses and validates a JSON body, rejecting oversized payloads. */
export async function parseJson<S extends ZodType>(request: Request, schema: S): Promise<S["_output"]> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new Error("Request body was not valid JSON.");
  }
  return schema.parse(body);
}

export function searchParams(request: Request): URLSearchParams {
  return new URL(request.url).searchParams;
}
