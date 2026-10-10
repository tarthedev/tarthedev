import { randomUUID } from "node:crypto";
import {
  type AuditContext,
  account,
  type Database,
  employees,
  insertWithAudit,
  user,
} from "@dwrg/db";
import type { CreateEmployeeInput, EmployeeListQuery, EmployeeResponse } from "@dwrg/shared";
import { and, asc, eq, exists, isNotNull, isNull, type SQL, sql } from "drizzle-orm";
import { type Auth, CREDENTIAL_PROVIDER_ID } from "../auth";
import { conflict } from "../errors";
import { hashPassword, setCredentialPassword } from "./logins";

/** Logins and their staff rows (owners and managers only; no pay here). */
export async function listEmployees(
  db: Database,
  query: EmployeeListQuery,
): Promise<EmployeeResponse[]> {
  const conditions: SQL[] = [];
  if (query.role) conditions.push(eq(user.role, query.role));
  if (query.active !== undefined) conditions.push(eq(user.active, query.active));

  const rows = await db
    .select({
      userId: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      active: user.active,
      createdAt: user.createdAt,
      employeeId: employees.id,
      stId: employees.stId,
      phone: employees.phone,
      skills: employees.skills,
      businessUnits: employees.businessUnits,
      hiredOn: employees.hiredOn,
      hasPassword: sql<boolean>`${exists(
        db
          .select({ one: sql`1` })
          .from(account)
          .where(
            and(
              eq(account.userId, user.id),
              eq(account.providerId, CREDENTIAL_PROVIDER_ID),
              isNotNull(account.password),
            ),
          ),
      )}`.mapWith(Boolean),
    })
    .from(user)
    .leftJoin(employees, and(eq(employees.userId, user.id), isNull(employees.deletedAt)))
    .where(and(...conditions))
    .orderBy(asc(sql`lower(${user.name})`), asc(user.id));

  return rows.map((r) => ({
    userId: r.userId,
    employeeId: r.employeeId,
    stId: r.stId,
    name: r.name,
    email: r.email,
    role: r.role,
    active: r.active,
    hasPassword: r.hasPassword,
    phone: r.phone,
    skills: r.skills ?? [],
    businessUnits: r.businessUnits ?? [],
    hiredOn: r.hiredOn,
    createdAt: r.createdAt.toISOString(),
  }));
}

/**
 * Creates a login (Better Auth user + credential account) and its employee
 * row in one transaction, each audited with the acting user and the reason.
 * The caller has already checked the actor may assign `input.role`.
 * Throws a 409 when the email is already used.
 */
export async function createEmployee(
  db: Database,
  auth: Auth,
  input: CreateEmployeeInput,
  ctx: AuditContext & { userId: string },
): Promise<EmployeeResponse> {
  // Hash outside the transaction: it is deliberately slow and needs no locks.
  const passwordHash = await hashPassword(auth, input.password);

  try {
    return await db.transaction(async (tx) => {
      const [taken] = await tx
        .select({ id: user.id })
        .from(user)
        .where(sql`lower(${user.email}) = ${input.email}`);
      if (taken) throw emailTaken();

      const login = await insertWithAudit(
        tx,
        user,
        {
          id: randomUUID(),
          name: input.name,
          email: input.email,
          emailVerified: false,
          role: input.role,
          active: true,
        },
        ctx,
      );
      await setCredentialPassword(tx, login.id, passwordHash, ctx);
      const staff = await insertWithAudit(
        tx,
        employees,
        {
          userId: login.id,
          phone: input.phone ?? null,
          skills: input.skills,
          businessUnits: input.businessUnits,
          hiredOn: input.hiredOn ?? null,
          createdBy: ctx.userId,
        },
        ctx,
      );

      return {
        userId: login.id,
        employeeId: staff.id,
        stId: staff.stId,
        name: login.name,
        email: login.email,
        role: login.role,
        active: login.active,
        hasPassword: true,
        phone: staff.phone,
        skills: staff.skills,
        businessUnits: staff.businessUnits,
        hiredOn: staff.hiredOn,
        createdAt: login.createdAt.toISOString(),
      };
    });
  } catch (error) {
    // Two requests racing for the same email: the unique index decides.
    if (isUniqueViolation(error, "user_email_unique")) throw emailTaken();
    throw error;
  }
}

function emailTaken() {
  return conflict("A login with this email already exists.", {
    email: ["A login with this email already exists"],
  });
}

/** Postgres unique_violation (23505), unwrapping Drizzle's query error. */
function isUniqueViolation(error: unknown, constraint?: string): boolean {
  for (let e: unknown = error; e instanceof Error; e = e.cause) {
    const pg = e as Error & { code?: unknown; constraint_name?: unknown };
    if (pg.code === "23505") {
      return constraint === undefined || pg.constraint_name === constraint;
    }
  }
  return false;
}
