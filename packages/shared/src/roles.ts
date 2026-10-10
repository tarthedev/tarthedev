import { oneOfSchema } from "./common";

/**
 * Who can do what (docs/03-tech-stack.md, Security). The lists mirror the
 * CHECK-constrained values in @dwrg/db; the API's tests assert they match.
 */

export const ROLES = ["owner", "manager", "dispatcher_csr", "tech", "installer"] as const;
export type Role = (typeof ROLES)[number];
export const roleSchema = oneOfSchema(ROLES);

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  manager: "Manager",
  dispatcher_csr: "Dispatcher / CSR",
  tech: "Tech",
  installer: "Installer",
};

/** Office staff: the people who work the board, the phones and the files. */
export const OFFICE_ROLES = [
  "owner",
  "manager",
  "dispatcher_csr",
] as const satisfies readonly Role[];

/** Who manages logins and people (and, later, payroll). */
export const PEOPLE_ADMIN_ROLES = ["owner", "manager"] as const satisfies readonly Role[];

export function isOfficeRole(role: Role): boolean {
  return (OFFICE_ROLES as readonly Role[]).includes(role);
}

/**
 * Whether `actor` may give someone the role `target`. Owners can create any
 * role; managers can create anyone except an owner, so no one can raise
 * themselves (or anyone else) above their own level. Everyone else: no one.
 */
export function canAssignRole(actor: Role, target: Role): boolean {
  if (actor === "owner") return true;
  if (actor === "manager") return target !== "owner";
  return false;
}

export const SKILLS = ["hvac", "plumbing", "refrigeration", "commercial"] as const;
export type Skill = (typeof SKILLS)[number];
export const skillSchema = oneOfSchema(SKILLS);

export const BUSINESS_UNIT_CODES = [
  "hvac_service",
  "hvac_replacement",
  "plumbing",
  "commercial",
  "new_construction",
] as const;
export type BusinessUnitCode = (typeof BUSINESS_UNIT_CODES)[number];
export const businessUnitCodeSchema = oneOfSchema(BUSINESS_UNIT_CODES);
