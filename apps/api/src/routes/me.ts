import { type Database, employees } from "@dwrg/db";
import type { MeResponse } from "@dwrg/shared";
import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import type { AuthedEnv } from "../context";

/** GET /api/me: any signed-in person, about themselves. */
export function meRoutes({ db }: { db: Database }) {
  return new Hono<AuthedEnv>().get("/me", async (c) => {
    const user = c.get("user");
    const [employee] = await db
      .select({
        id: employees.id,
        phone: employees.phone,
        skills: employees.skills,
        businessUnits: employees.businessUnits,
      })
      .from(employees)
      .where(and(eq(employees.userId, user.id), isNull(employees.deletedAt)));
    const body: MeResponse = {
      user: { id: user.id, name: user.name, email: user.email, role: user.role, image: user.image },
      employee: employee ?? null,
      session: { expiresAt: c.get("session").expiresAt.toISOString() },
    };
    return c.json(body);
  });
}
