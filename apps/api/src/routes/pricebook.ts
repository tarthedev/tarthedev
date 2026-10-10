import type { Database } from "@dwrg/db";
import { OFFICE_ROLES, pricebookQuerySchema } from "@dwrg/shared";
import { Hono } from "hono";
import type { AuthedEnv } from "../context";
import { requireRole } from "../middleware/session";
import { validate } from "../middleware/validate";
import { listPricebook } from "../services/pricebook";

/** GET /api/pricebook?q=&kind=&category=&includeInactive=&page=&pageSize= (office roles). */
export function pricebookRoutes({ db }: { db: Database }) {
  return new Hono<AuthedEnv>().get(
    "/",
    requireRole(...OFFICE_ROLES),
    validate("query", pricebookQuerySchema),
    async (c) => c.json(await listPricebook(db, c.req.valid("query"))),
  );
}
