import { z } from "zod";
import { instantSchema, localDateSchema, phoneInputSchema, queryBooleanSchema } from "./common";
import { businessUnitCodeSchema, roleSchema, skillSchema } from "./roles";

/**
 * Logins and staff (owners and managers only). Pay rates are not part of
 * these responses: they live in pay_rates and get their own endpoints.
 */

/** GET /api/employees?role=&active= */
export const employeeListQuerySchema = z.object({
  role: roleSchema.optional(),
  /** Default: everyone. `true` = only people who can sign in, `false` = only turned-off logins. */
  active: queryBooleanSchema.optional(),
});
export type EmployeeListQuery = z.infer<typeof employeeListQuerySchema>;

export const employeeSchema = z.object({
  /** The login (Better Auth user) id; the id other tables reference. */
  userId: z.string(),
  /** The employees row, null for a login without staff details. */
  employeeId: z.string().nullable(),
  stId: z.string().nullable(),
  name: z.string(),
  email: z.email(),
  role: roleSchema,
  active: z.boolean(),
  /** Has an email-and-password login. */
  hasPassword: z.boolean(),
  phone: z.string().nullable(),
  skills: z.array(skillSchema),
  businessUnits: z.array(businessUnitCodeSchema),
  hiredOn: localDateSchema.nullable(),
  createdAt: instantSchema,
});
export type EmployeeResponse = z.infer<typeof employeeSchema>;

export const employeeListResponseSchema = z.object({ items: z.array(employeeSchema) });
export type EmployeeListResponse = z.infer<typeof employeeListResponseSchema>;

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

function uniqueList<T extends z.ZodType>(item: T, max: number) {
  return z
    .array(item)
    .max(max)
    .default([])
    .transform((list) => [...new Set(list)]);
}

/**
 * POST /api/employees: an owner or manager creates a login with a role (and
 * the staff row beside it). There is no public sign-up. Managers can't create
 * owners. The change is written to audit_log with `reason`.
 */
export const createEmployeeRequestSchema = z.strictObject({
  name: z
    .string({ error: "Enter a name" })
    .trim()
    .min(1, { error: "Enter a name" })
    .max(200, { error: "Must be 200 characters or less" }),
  email: z
    .string({ error: "Enter an email address" })
    .trim()
    .toLowerCase()
    .pipe(z.email({ error: "Enter a valid email address" }).max(254)),
  role: roleSchema,
  password: z
    .string({ error: "Enter a password" })
    .min(MIN_PASSWORD_LENGTH, { error: `Use at least ${MIN_PASSWORD_LENGTH} characters` })
    .max(MAX_PASSWORD_LENGTH, { error: `Use at most ${MAX_PASSWORD_LENGTH} characters` }),
  phone: phoneInputSchema.optional(),
  skills: uniqueList(skillSchema, 10),
  businessUnits: uniqueList(businessUnitCodeSchema, 10),
  hiredOn: localDateSchema.optional(),
  /** Why the login is being created; recorded in the audit log. */
  reason: z.string().trim().min(1).max(500, { error: "Must be 500 characters or less" }).optional(),
});
export type CreateEmployeeRequest = z.input<typeof createEmployeeRequestSchema>;
export type CreateEmployeeInput = z.output<typeof createEmployeeRequestSchema>;
