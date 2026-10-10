import { localDateOf } from "@dwrg/core";
import type { Database } from "@dwrg/db";
import { customerSearchQuerySchema, idParamSchema, OFFICE_ROLES } from "@dwrg/shared";
import { Hono } from "hono";
import type { AuthedEnv } from "../context";
import { notFound } from "../errors";
import { requireRole } from "../middleware/session";
import { validate } from "../middleware/validate";
import { getCustomerDetail, searchCustomers } from "../services/customers";

export interface CustomerRouteDeps {
  db: Database;
  /** The clock for "today" (equipment ages); tests pin it. */
  now?: () => Date;
}

/**
 * Customers (office roles for now; techs will see only their jobs' customers).
 * - GET /api/customers?q=&type=&page=&pageSize=  search by name, phone or address
 * - GET /api/customers/:id                       the customer's file
 */
export function customerRoutes({ db, now = () => new Date() }: CustomerRouteDeps) {
  return new Hono<AuthedEnv>()
    .get(
      "/",
      requireRole(...OFFICE_ROLES),
      validate("query", customerSearchQuerySchema),
      async (c) => c.json(await searchCustomers(db, c.req.valid("query"))),
    )
    .get("/:id", requireRole(...OFFICE_ROLES), validate("param", idParamSchema), async (c) => {
      const detail = await getCustomerDetail(db, c.req.valid("param").id, localDateOf(now()));
      if (!detail) throw notFound("No customer with that id.");
      return c.json(detail);
    });
}
