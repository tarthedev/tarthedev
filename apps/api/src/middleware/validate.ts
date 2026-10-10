import { fieldErrorsFrom } from "@dwrg/shared";
import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import type { z } from "zod";
import { ApiError, validationFailed } from "../errors";

const JSON_TYPE = /^application\/([a-z-.]+\+)?json(\s*;.*)?$/i;

const MESSAGES: Partial<Record<keyof ValidationTargets, string>> = {
  json: "Check the highlighted fields.",
  query: "Check the search options.",
  param: "Check the address of this request.",
};

/**
 * Zod validation for a request part. Failures are 400 validation_failed with
 * field messages keyed by dotted path, e.g. { "email": ["Enter a valid email address"] }.
 * JSON bodies must be sent as application/json (415 otherwise), which also
 * means a cross-site HTML form can't post to the API.
 */
export function validate<T extends z.ZodType, Target extends keyof ValidationTargets>(
  target: Target,
  schema: T,
) {
  return zValidator(target, schema, (result, c) => {
    if (target === "json" && !JSON_TYPE.test(c.req.header("Content-Type") ?? "")) {
      throw new ApiError(415, "unsupported_media_type", "Send the request body as JSON.");
    }
    if (!result.success) {
      throw validationFailed(fieldErrorsFrom(result.error), MESSAGES[target]);
    }
  });
}
