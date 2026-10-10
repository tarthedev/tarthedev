import {
  type BusinessUnitCode,
  businessUnits,
  customers,
  type Executor,
  employees,
  equipment,
  invoices,
  jobs,
  locations,
  membershipPlans,
  type Origin,
  type PricebookKind,
  payments,
  pricebookItems,
  user,
} from "@dwrg/db";
import { and, eq, inArray } from "drizzle-orm";
import { RowError } from "./errors";
import { BUSINESS_UNIT_NAMES, labelOf } from "./mappings/values";
import { insertAudited } from "./write";

/** In preview nothing is written, so references to rows the file itself creates use this id. */
export const PENDING_ID = "(created by this file)";

const CHUNK = 5_000;

function chunks<T>(values: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += CHUNK) out.push(values.slice(i, i + CHUNK));
  return out;
}

function unique(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => typeof v === "string" && v !== ""))];
}

function nameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * What an import needs to know about rows already in the database, loaded
 * with one query per table and kept up to date as groups of rows commit.
 * Resolvers throw RowError with a readable message when a reference is missing.
 */
export class Lookups {
  readonly businessUnits = new Map<BusinessUnitCode, string>();
  readonly employeesByStId = new Map<string, { id: string; userId: string }>();
  readonly usersByEmail = new Map<
    string,
    { id: string; employeeId: string | null; employeeStId: string | null }
  >();
  readonly userIdsByName = new Map<string, string[]>();
  readonly pricebookByCode = new Map<
    string,
    { id: string; stId: string | null; kind: PricebookKind }
  >();
  readonly customers = new Map<string, string>();
  readonly locations = new Map<string, { id: string; customerId: string }>();
  readonly jobs = new Map<string, string>();
  readonly invoices = new Map<string, { id: string; origin: Origin; jobId: string | null }>();
  readonly equipment = new Map<string, { id: string; deletedAt: Date | null }>();
  readonly plansByStId = new Map<string, string>();
  readonly plansByName = new Map<string, string>();
  /** Job and invoice numbers in use -> the ServiceTitan ID of the record using it (null: created here). */
  readonly jobNumbers = new Map<string, string | null>();
  readonly invoiceNumbers = new Map<string, string | null>();
  /** Preview only: ServiceTitan IDs the file itself creates, by table. */
  readonly pending = { jobs: new Set<string>() };
  /**
   * ServiceTitan IDs on jobs, invoices and payments created in this system
   * (origin "new"). Imports never change those (CLAUDE.md rules 11 to 13).
   */
  readonly ownedHere = {
    jobs: new Set<string>(),
    invoices: new Set<string>(),
    payments: new Set<string>(),
  };

  constructor(
    readonly db: Executor,
    readonly mode: "import" | "preview",
  ) {}

  // --- loading -------------------------------------------------------------

  async loadBusinessUnits(): Promise<void> {
    const rows = await this.db
      .select({ id: businessUnits.id, code: businessUnits.code })
      .from(businessUnits);
    for (const row of rows) this.businessUnits.set(row.code, row.id);
  }

  /** Every employee and user (staff lists are small). */
  async loadPeople(): Promise<void> {
    const users = await this.db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(user);
    const staff = await this.db
      .select({ id: employees.id, stId: employees.stId, userId: employees.userId })
      .from(employees);
    const employeeOf = new Map(staff.map((e) => [e.userId, e]));
    for (const u of users) {
      const employee = employeeOf.get(u.id);
      this.usersByEmail.set(u.email.toLowerCase(), {
        id: u.id,
        employeeId: employee?.id ?? null,
        employeeStId: employee?.stId ?? null,
      });
      const key = nameKey(u.name);
      this.userIdsByName.set(key, [...(this.userIdsByName.get(key) ?? []), u.id]);
    }
    for (const e of staff) {
      if (e.stId) this.employeesByStId.set(e.stId, { id: e.id, userId: e.userId });
    }
  }

  async loadPricebook(): Promise<void> {
    const rows = await this.db
      .select({
        id: pricebookItems.id,
        stId: pricebookItems.stId,
        code: pricebookItems.code,
        kind: pricebookItems.kind,
      })
      .from(pricebookItems);
    for (const row of rows) {
      this.pricebookByCode.set(row.code, { id: row.id, stId: row.stId, kind: row.kind });
    }
  }

  async loadPlans(): Promise<void> {
    const rows = await this.db
      .select({ id: membershipPlans.id, stId: membershipPlans.stId, name: membershipPlans.name })
      .from(membershipPlans);
    for (const row of rows) {
      if (row.stId) this.plansByStId.set(row.stId, row.id);
      if (!this.plansByName.has(nameKey(row.name))) this.plansByName.set(nameKey(row.name), row.id);
    }
  }

  async loadCustomers(stIds: readonly (string | null | undefined)[]): Promise<void> {
    for (const part of chunks(unique(stIds))) {
      const rows = await this.db
        .select({ id: customers.id, stId: customers.stId })
        .from(customers)
        .where(inArray(customers.stId, part));
      for (const row of rows) if (row.stId) this.customers.set(row.stId, row.id);
    }
  }

  async loadLocations(stIds: readonly (string | null | undefined)[]): Promise<void> {
    for (const part of chunks(unique(stIds))) {
      const rows = await this.db
        .select({ id: locations.id, stId: locations.stId, customerId: locations.customerId })
        .from(locations)
        .where(inArray(locations.stId, part));
      for (const row of rows) {
        if (row.stId) this.locations.set(row.stId, { id: row.id, customerId: row.customerId });
      }
    }
  }

  async loadJobs(stIds: readonly (string | null | undefined)[]): Promise<void> {
    for (const part of chunks(unique(stIds))) {
      const rows = await this.db
        .select({ id: jobs.id, stId: jobs.stId, origin: jobs.origin })
        .from(jobs)
        .where(inArray(jobs.stId, part));
      for (const row of rows) {
        if (!row.stId) continue;
        this.jobs.set(row.stId, row.id);
        if (row.origin === "new") this.ownedHere.jobs.add(row.stId);
      }
    }
  }

  /** Which of these job numbers are taken, and by which ServiceTitan job. */
  async loadJobNumbers(numbers: readonly (string | null | undefined)[]): Promise<void> {
    for (const part of chunks(unique(numbers))) {
      const rows = await this.db
        .select({ number: jobs.number, stId: jobs.stId })
        .from(jobs)
        .where(inArray(jobs.number, part));
      for (const row of rows) this.jobNumbers.set(row.number, row.stId);
    }
  }

  /** Which of these invoice numbers are taken, and by which ServiceTitan invoice. */
  async loadInvoiceNumbers(numbers: readonly (string | null | undefined)[]): Promise<void> {
    for (const part of chunks(unique(numbers))) {
      const rows = await this.db
        .select({ number: invoices.number, stId: invoices.stId })
        .from(invoices)
        .where(inArray(invoices.number, part));
      for (const row of rows) this.invoiceNumbers.set(row.number, row.stId);
    }
  }

  /**
   * Imported jobs and invoices keep ServiceTitan's number, which must not
   * already belong to a different record (one created in this system).
   */
  numberFree(kind: "job" | "invoice", number: string, stId: string, column: string): void {
    const owners = kind === "job" ? this.jobNumbers : this.invoiceNumbers;
    if (!owners.has(number)) return;
    const owner = owners.get(number);
    if (owner === stId) return;
    const what = kind === "job" ? "Job" : "Invoice";
    throw new RowError(
      owner
        ? `${what} number ${number} already belongs to ServiceTitan ${kind} ${owner}.`
        : `${what} number ${number} already belongs to ${kind === "job" ? "a job" : "an invoice"} created in this system.`,
      undefined,
      column,
    );
  }

  async loadInvoices(stIds: readonly (string | null | undefined)[]): Promise<void> {
    for (const part of chunks(unique(stIds))) {
      const rows = await this.db
        .select({
          id: invoices.id,
          stId: invoices.stId,
          origin: invoices.origin,
          jobId: invoices.jobId,
        })
        .from(invoices)
        .where(inArray(invoices.stId, part));
      for (const row of rows) {
        if (!row.stId) continue;
        this.invoices.set(row.stId, { id: row.id, origin: row.origin, jobId: row.jobId });
        if (row.origin === "new") this.ownedHere.invoices.add(row.stId);
      }
    }
  }

  /** Which of these payments were created in this system (only that matters to an import). */
  async loadPayments(stIds: readonly (string | null | undefined)[]): Promise<void> {
    for (const part of chunks(unique(stIds))) {
      const rows = await this.db
        .select({ stId: payments.stId })
        .from(payments)
        .where(and(inArray(payments.stId, part), eq(payments.origin, "new")));
      for (const row of rows) if (row.stId) this.ownedHere.payments.add(row.stId);
    }
  }

  /** Rejects a row that would change a job, invoice or payment created in this system. */
  notOwnedHere(kind: keyof Lookups["ownedHere"], stId: string, column: string): void {
    if (!this.ownedHere[kind].has(stId)) return;
    const what = { jobs: "Job", invoices: "Invoice", payments: "Payment" }[kind];
    throw new RowError(
      `${what} ${stId} was created in this system, so ServiceTitan rows can't change it.`,
      undefined,
      column,
    );
  }

  async loadEquipment(stIds: readonly (string | null | undefined)[]): Promise<void> {
    for (const part of chunks(unique(stIds))) {
      const rows = await this.db
        .select({ id: equipment.id, stId: equipment.stId, deletedAt: equipment.deletedAt })
        .from(equipment)
        .where(inArray(equipment.stId, part));
      for (const row of rows) {
        if (row.stId) this.equipment.set(row.stId, { id: row.id, deletedAt: row.deletedAt });
      }
    }
  }

  /**
   * Creates the business units these codes need (import mode). Business
   * units have fixed codes, so creating a missing one is safe; its name is
   * the first ServiceTitan name in the mapping config.
   */
  async ensureBusinessUnits(
    codes: readonly BusinessUnitCode[],
    audit: { userId: string | null; reason: string },
  ): Promise<void> {
    for (const code of new Set(codes)) {
      if (this.businessUnits.has(code)) continue;
      const name = labelOf(BUSINESS_UNIT_NAMES, code);
      const row = await insertAudited(
        this.db,
        businessUnits,
        { code, name, qboClass: name },
        audit,
        "import",
      );
      this.businessUnits.set(code, row.id);
    }
  }

  // --- resolvers -----------------------------------------------------------

  businessUnit(code: BusinessUnitCode): string {
    const id = this.businessUnits.get(code);
    if (id) return id;
    if (this.mode === "preview") return PENDING_ID;
    throw new RowError(`Business unit ${code} is missing.`);
  }

  customer(stId: string, column: string): string {
    const id = this.customers.get(stId);
    if (id) return id;
    throw new RowError(
      `Customer ${stId} is not in the system yet. Import the customers report first.`,
      undefined,
      column,
    );
  }

  location(stId: string, column: string): { id: string; customerId: string } {
    const found = this.locations.get(stId);
    if (found) return found;
    throw new RowError(
      `Location ${stId} is not in the system yet. Import the customers report first.`,
      undefined,
      column,
    );
  }

  job(stId: string, column: string): string {
    const id = this.jobs.get(stId);
    if (id) return id;
    if (this.mode === "preview" && this.pending.jobs.has(stId)) return PENDING_ID;
    throw new RowError(
      `Job ${stId} is not in the system yet. Import the invoices report (jobs and invoices) first.`,
      undefined,
      column,
    );
  }

  invoice(stId: string, column: string): { id: string; jobId: string | null } {
    const found = this.invoices.get(stId);
    if (!found) {
      throw new RowError(
        `Invoice ${stId} is not in the system yet. Import the invoices report first.`,
        undefined,
        column,
      );
    }
    if (found.origin !== "servicetitan") {
      throw new RowError(
        `Invoice ${stId} was created in this system, so ServiceTitan rows can't change it.`,
        undefined,
        column,
      );
    }
    return found;
  }

  /** A person by ServiceTitan technician ID, or else by their exact full name. */
  person(value: string, column: string): string {
    const byId = this.employeesByStId.get(value);
    if (byId) return byId.userId;
    const byName = this.userIdsByName.get(nameKey(value)) ?? [];
    if (byName.length === 1 && byName[0]) return byName[0];
    if (byName.length > 1) {
      throw new RowError(
        `${byName.length} people are named "${value}". Use their Technician ID instead.`,
        undefined,
        column,
      );
    }
    throw new RowError(
      `"${value}" doesn't match a technician. Import the technicians report first.`,
      undefined,
      column,
    );
  }

  plan(stId: string | null, name: string): string | null {
    if (stId) {
      const byId = this.plansByStId.get(stId);
      if (byId) return byId;
    }
    return this.plansByName.get(nameKey(name)) ?? null;
  }

  rememberPlan(id: string, stId: string | null, name: string): void {
    if (stId) this.plansByStId.set(stId, id);
    if (!this.plansByName.has(nameKey(name))) this.plansByName.set(nameKey(name), id);
  }

  rememberPerson(
    userId: string,
    employee: { id: string; stId: string },
    name: string,
    email: string,
  ): void {
    this.employeesByStId.set(employee.stId, { id: employee.id, userId });
    this.usersByEmail.set(email.toLowerCase(), {
      id: userId,
      employeeId: employee.id,
      employeeStId: employee.stId,
    });
    const key = nameKey(name);
    const ids = this.userIdsByName.get(key) ?? [];
    if (!ids.includes(userId)) this.userIdsByName.set(key, [...ids, userId]);
  }
}
