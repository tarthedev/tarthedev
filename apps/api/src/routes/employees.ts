import type { Database } from "@dwrg/db";
import {
  canAssignRole,
  createEmployeeRequestSchema,
  type EmployeeListResponse,
  employeeListQuerySchema,
  PEOPLE_ADMIN_ROLES,
  ROLE_LABELS,
} from "@dwrg/shared";
import { Hono } from "hono";
import type { Auth } from "../auth";
import type { AuthedEnv } from "../context";
import { ApiError } from "../errors";
import { requireRole } from "../middleware/session";
import { validate } from "../middleware/validate";
import { createEmployee, listEmployees } from "../services/employees";

/**
 * Logins and staff (owners and managers only; docs/03-tech-stack.md, Security).
 * - GET  /api/employees?role=&active=  everyone with a login, no pay
 * - POST /api/employees                create a login with a role (audited)
 *
 * There is no public sign-up: this is the only way a login is created.
 */
export function employeeRoutes({ db, auth }: { db: Database; auth: Auth }) {
  return new Hono<AuthedEnv>()
    .get(
      "/",
      requireRole(...PEOPLE_ADMIN_ROLES),
      validate("query", employeeListQuerySchema),
      async (c) => {
        const body: EmployeeListResponse = {
          items: await listEmployees(db, c.req.valid("query")),
        };
        return c.json(body);
      },
    )
    .post(
      "/",
      requireRole(...PEOPLE_ADMIN_ROLES),
      validate("json", createEmployeeRequestSchema),
      async (c) => {
        const actor = c.get("user");
        const input = c.req.valid("json");
        if (!canAssignRole(actor.role, input.role)) {
          throw new ApiError(
            403,
            "forbidden",
            `${ROLE_LABELS[actor.role]} logins can't create ${ROLE_LABELS[input.role]} logins.`,
            { role: [`You can't create ${ROLE_LABELS[input.role]} logins`] },
          );
        }
        const reason = input.reason ?? `New ${ROLE_LABELS[input.role]} login`;
        const audit = c.get("audit");
        const created = await createEmployee(db, auth, input, {
          ...audit.ctx(reason),
          userId: audit.userId,
        });
        c.get("log").info("login created", {
          actorId: actor.id,
          userId: created.userId,
          role: created.role,
        });
        return c.json(created, 201);
      },
    );
}
