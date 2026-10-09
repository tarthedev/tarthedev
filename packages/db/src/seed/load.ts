import { count, getTableColumns, inArray, isNull, like, not, or, sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { writeAudit } from "../audit";
import type { Database, Executor, Transaction } from "../client";
import {
  appointments,
  assignments,
  businessUnits,
  contacts,
  customers,
  employees,
  equipment,
  invoiceLines,
  invoices,
  jobCosts,
  jobs,
  locations,
  membershipPlans,
  memberships,
  payments,
  payRates,
  pricebookItems,
  settings,
  systemOfRecord,
  timeEntries,
  user,
} from "../schema";
import {
  DEMO_EMAIL_DOMAIN,
  DEMO_REASON,
  DEMO_ST_PREFIX,
  type DemoData,
  generateDemoData,
} from "./generate";
import { type DemoSummary, summarizeDemoData } from "./summary";

/**
 * Loads demo data into a database. Idempotent: it deletes the previous demo
 * rows (st_id "DEMO-...", demo settings, demo users' pay rates) and inserts a
 * fresh set in one transaction. It refuses to run when the database holds
 * any non-demo business data (imported or created rows), so it can never
 * mix with or delete real data. Demo users are upserted, so their sessions
 * survive a reseed.
 */

const ADVISORY_LOCK_KEY = 72_042_211;

/** Tables whose rows carry an st_id; a row without a DEMO- st_id is real data. */
const ST_ID_TABLES = {
  businessUnits,
  employees,
  pricebookItems,
  membershipPlans,
  customers,
  locations,
  contacts,
  equipment,
  memberships,
  jobs,
  appointments,
  assignments,
  timeEntries,
  invoices,
  invoiceLines,
  payments,
  jobCosts,
} as const;

export class DemoSeedRefusedError extends Error {
  constructor(readonly nonDemoRows: Record<string, number>) {
    const list = Object.entries(nonDemoRows)
      .map(([table, n]) => `${table}: ${n}`)
      .join(", ");
    super(`Refusing to seed: the database holds non-demo data (${list}).`);
    this.name = "DemoSeedRefusedError";
  }
}

export interface SeedResult {
  summary: DemoSummary;
  ms: number;
}

/** Counts rows per table that are not demo rows. Empty when the database is demo-only. */
export async function findNonDemoRows(db: Executor): Promise<Record<string, number>> {
  const found: Record<string, number> = {};
  for (const [name, table] of Object.entries(ST_ID_TABLES)) {
    const [row] = await db
      .select({ n: count() })
      .from(table as PgTable)
      .where(or(isNull(table.stId), not(like(table.stId, `${DEMO_ST_PREFIX}%`))));
    if (row && row.n > 0) found[name] = row.n;
  }
  return found;
}

export async function seedDemoData(
  db: Database,
  data: DemoData = generateDemoData(),
): Promise<SeedResult> {
  const started = Date.now();
  const summary = summarizeDemoData(data);
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${ADVISORY_LOCK_KEY})`);
    const nonDemo = await findNonDemoRows(tx);
    if (Object.keys(nonDemo).length > 0) throw new DemoSeedRefusedError(nonDemo);
    await clearDemoRows(tx, data);
    await insertDemoRows(tx, data);
    await writeAudit(tx, {
      tableName: "*",
      rowId: "demo-seed",
      action: "bulk_load",
      before: null,
      after: {
        options: data.options,
        counts: summary.counts,
        totals: summary.totals,
        fingerprint: summary.fingerprint,
      },
      userId: null,
      reason: DEMO_REASON,
    });
  });
  return { summary, ms: Date.now() - started };
}

/** Deletes every demo row, children first. Demo users are kept (they are upserted). */
async function clearDemoRows(tx: Transaction, data: DemoData): Promise<void> {
  const demo = (column: PgColumn) => like(column, `${DEMO_ST_PREFIX}%`);
  await tx.delete(jobCosts).where(demo(jobCosts.stId));
  await tx.delete(payments).where(demo(payments.stId));
  await tx.delete(invoiceLines).where(demo(invoiceLines.stId));
  await tx.delete(invoices).where(demo(invoices.stId));
  await tx.delete(timeEntries).where(demo(timeEntries.stId));
  await tx.delete(assignments).where(demo(assignments.stId));
  await tx.delete(appointments).where(demo(appointments.stId));
  await tx.delete(jobs).where(demo(jobs.stId));
  await tx.delete(memberships).where(demo(memberships.stId));
  await tx.delete(equipment).where(demo(equipment.stId));
  await tx.delete(contacts).where(demo(contacts.stId));
  await tx.delete(locations).where(demo(locations.stId));
  await tx.delete(customers).where(demo(customers.stId));
  await tx.delete(pricebookItems).where(demo(pricebookItems.stId));
  await tx.delete(membershipPlans).where(demo(membershipPlans.stId));

  const demoUsers = tx
    .select({ id: user.id })
    .from(user)
    .where(like(user.email, `%@${DEMO_EMAIL_DOMAIN}`));
  const demoUnits = tx
    .select({ id: businessUnits.id })
    .from(businessUnits)
    .where(demo(businessUnits.stId));
  await tx
    .delete(systemOfRecord)
    .where(
      or(
        inArray(systemOfRecord.userId, demoUsers),
        inArray(systemOfRecord.businessUnitId, demoUnits),
      ),
    );
  await tx.delete(settings).where(sql`${settings.reason} = ${DEMO_REASON}`);
  await tx.delete(payRates).where(inArray(payRates.userId, demoUsers));
  await tx.delete(employees).where(demo(employees.stId));
  await tx.delete(businessUnits).where(demo(businessUnits.stId));

  // Demo users from an earlier seed with different options.
  const keep = data.users.map((u) => u.id);
  await tx
    .delete(user)
    .where(
      keep.length
        ? sql`${user.email} like ${`%@${DEMO_EMAIL_DOMAIN}`} and ${not(inArray(user.id, keep))}`
        : like(user.email, `%@${DEMO_EMAIL_DOMAIN}`),
    );
}

async function insertDemoRows(tx: Transaction, data: DemoData): Promise<void> {
  await insertAll(tx, businessUnits, data.businessUnits);
  for (const batch of batches(data.users, columnCount(user))) {
    await tx
      .insert(user)
      .values(batch)
      .onConflictDoUpdate({
        target: user.id,
        set: {
          name: sql`excluded.name`,
          email: sql`excluded.email`,
          emailVerified: sql`excluded.email_verified`,
          role: sql`excluded.role`,
          active: sql`excluded.active`,
        },
      });
  }
  await insertAll(tx, employees, data.employees);
  await insertAll(tx, payRates, data.payRates);
  await insertAll(tx, settings, data.settings);
  await insertAll(tx, systemOfRecord, data.systemOfRecord);
  await insertAll(tx, pricebookItems, data.pricebookItems);
  await insertAll(tx, membershipPlans, data.membershipPlans);
  await insertAll(tx, customers, data.customers);
  await insertAll(tx, locations, data.locations);
  await insertAll(tx, contacts, data.contacts);
  await insertAll(tx, equipment, data.equipment);
  await insertAll(tx, memberships, data.memberships);
  await insertAll(tx, jobs, data.jobs);
  await insertAll(tx, appointments, data.appointments);
  await insertAll(tx, assignments, data.assignments);
  await insertAll(tx, timeEntries, data.timeEntries);
  await insertAll(tx, invoices, data.invoices);
  await insertAll(tx, invoiceLines, data.invoiceLines);
  await insertAll(tx, payments, data.payments);
  await insertAll(tx, jobCosts, data.jobCosts);
}

async function insertAll<T extends PgTable>(
  tx: Transaction,
  table: T,
  rows: T["$inferInsert"][],
): Promise<void> {
  for (const batch of batches(rows, columnCount(table))) {
    await tx.insert(table).values(batch);
  }
}

function columnCount(table: PgTable): number {
  return Object.keys(getTableColumns(table)).length;
}

/** Splits rows so one INSERT stays well under Postgres's 65535 bind parameters. */
function batches<T>(rows: T[], columns: number): T[][] {
  const size = Math.max(1, Math.floor(30_000 / Math.max(1, columns)));
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}
