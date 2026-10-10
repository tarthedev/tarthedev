import { randomUUID } from "node:crypto";
import {
  type BusinessUnitCode,
  employees,
  type Role,
  type Skill,
  type UpsertResult,
  user,
} from "@dwrg/db";
import { rowResult } from "../context";
import { RowError } from "../errors";
import type { Lookups } from "../lookups";
import { techniciansMapping } from "../mappings/technicians";
import { BUSINESS_UNIT_NAMES, ROLE_NAMES, SKILL_NAMES } from "../mappings/values";
import { type ColumnLabel, defineHandler } from "./types";

type TechnicianField = keyof typeof techniciansMapping.fields;

export interface TechnicianRow {
  stId: string;
  name: string;
  /** Lower-cased: sign-in emails are case-insensitive. */
  email: string;
  phone: string | null | undefined;
  /** Used only when the person is new here: roles are managed in this system, not imported. */
  role: Role | null | undefined;
  businessUnits: BusinessUnitCode[] | undefined;
  skills: Skill[] | undefined;
  hiredOn: string | null | undefined;
  active: boolean | null | undefined;
}

/**
 * Technicians (and office staff) become a sign-in user plus an employee row.
 * A new person gets the mapped role and no password (they are invited later).
 * For people already here, name, email, phone, skills, business units and
 * active are kept in step with ServiceTitan, but the role never changes from
 * an import: roles grant access, so they change only in this system.
 * Pay rates are not in the export and stay as set here.
 */
export const techniciansHandler = defineHandler({
  mapping: techniciansMapping,

  parse(r): TechnicianRow {
    const email = r.need("email", r.email("email"), "");
    return {
      stId: r.requiredId("technicianId"),
      name: r.requiredText("name"),
      email: email.toLowerCase(),
      phone: r.phone("phone"),
      role: r.choice("role", ROLE_NAMES),
      businessUnits: r.choices("businessUnits", BUSINESS_UNIT_NAMES),
      skills: r.choices("skills", SKILL_NAMES),
      hiredOn: r.date("hireDate"),
      active: r.bool("active"),
    };
  },

  stIdOf: (row) => row.stId,

  claims: (row) => [
    { key: `employees:${row.stId}`, label: `Technician ${row.stId}`, details: { ...row } },
    { key: `user-email:${row.email}`, label: `Email ${row.email}`, details: { stId: row.stId } },
  ],

  businessUnits: () => [],

  async load(lookups) {
    await lookups.loadPeople();
  },

  check: (lookups, row, column) => checkPerson(lookups, row, column),

  async importGroup(scope, rows, column) {
    const [parsed] = rows;
    if (!parsed) return [];
    const row = parsed.value;
    const { lookups } = scope;
    checkPerson(lookups, row, column);

    const employeeValues = {
      stId: row.stId,
      ...(row.phone !== undefined ? { phone: row.phone } : {}),
      ...(row.skills !== undefined ? { skills: row.skills } : {}),
      ...(row.businessUnits !== undefined ? { businessUnits: row.businessUnits } : {}),
      ...(row.hiredOn !== undefined ? { hiredOn: row.hiredOn } : {}),
    };
    const userPatch = {
      name: row.name,
      email: row.email,
      ...(row.active !== undefined && row.active !== null ? { active: row.active } : {}),
    };

    let userId: string;
    let userResult: UpsertResult;
    const existing = lookups.employeesByStId.get(row.stId);
    const byEmail = lookups.usersByEmail.get(row.email);
    if (existing ?? byEmail) {
      userId = existing?.userId ?? byEmail?.id ?? "";
      const updated = await scope.upsert(user, user.id, userId, { id: userId, ...userPatch });
      userResult = updated.result;
    } else {
      userId = randomUUID();
      await scope.insert(user, {
        id: userId,
        ...userPatch,
        emailVerified: false,
        role: row.role ?? "tech",
        active: row.active ?? true,
      });
      userResult = "inserted";
    }

    let employeeId: string;
    let employeeResult: UpsertResult;
    if (!existing && byEmail?.employeeId && !byEmail.employeeStId) {
      // Someone set up here before the import: link their employee row to ServiceTitan.
      const adopted = await scope.update(
        employees,
        byEmail.employeeId,
        { ...employeeValues, userId },
        "linked to ServiceTitan",
      );
      employeeId = adopted.id;
      employeeResult = "updated";
    } else {
      const upserted = await scope.upsert(employees, employees.stId, row.stId, {
        ...employeeValues,
        userId,
      });
      employeeId = upserted.id;
      employeeResult = upserted.result;
    }

    scope.onCommit(() =>
      lookups.rememberPerson(userId, { id: employeeId, stId: row.stId }, row.name, row.email),
    );
    return [
      {
        rowNumber: parsed.rowNumber,
        result: rowResult(employeeResult, [userResult]),
        stId: row.stId,
        targetTable: "employees",
        targetId: employeeId,
        error: null,
      },
    ];
  },
});

function checkPerson(
  lookups: Lookups,
  row: TechnicianRow,
  column: ColumnLabel<TechnicianField>,
): void {
  const byEmail = lookups.usersByEmail.get(row.email);
  const existing = lookups.employeesByStId.get(row.stId);
  if (byEmail?.employeeStId && byEmail.employeeStId !== row.stId) {
    throw new RowError(
      `${row.email} already belongs to technician ${byEmail.employeeStId}.`,
      undefined,
      column("email"),
    );
  }
  if (existing && byEmail && byEmail.id !== existing.userId) {
    throw new RowError(
      `${row.email} already belongs to another user here.`,
      undefined,
      column("email"),
    );
  }
}
