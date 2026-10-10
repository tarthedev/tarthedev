import { BUSINESS_TIME_ZONE, parseMoney } from "@dwrg/core";
import { type Executor, type StImportMetric, stImportBatches, stImportTotals } from "@dwrg/db";
import { and, asc, eq, isNull, type SQL, sql } from "drizzle-orm";
import { StImportError } from "./errors";
import { isReportType, normalizeLabel, type ReportType } from "./mappings/types";
import { BUSINESS_UNIT_NAMES, lookupValue } from "./mappings/values";

/**
 * The import report (docs/06 "Prove it"): counts and dollar totals per
 * business unit and year, computed from what is now in our database for the
 * rows this batch imported (rejected rows are left out), next to the totals
 * from ServiceTitan's own summary reports.
 *
 * Reports with no business unit (customers, technicians, ...) use the
 * business unit "none"; reports with no date use year 0. Dollars are
 * integer cents.
 */
export const NO_BUSINESS_UNIT = "none";
export const ALL_YEARS = 0;

const NOT_IN_IMPORT = "Not in this import";
const NOT_IN_SUMMARY = "Not in ServiceTitan's summary";

export interface TotalRow {
  businessUnitCode: string;
  year: number;
  metric: StImportMetric;
  ours: number;
  servicetitanSummary: number | null;
  /** ours - servicetitanSummary; null when ServiceTitan's summary has no such line. */
  diff: number | null;
  note: string | null;
}

/** What each report counts, and what its dollars are. */
export const TOTALS_MEANING: Readonly<Record<ReportType, { count: string; dollars?: string }>> = {
  technicians: { count: "technicians" },
  pricebook: { count: "pricebook items" },
  customers: { count: "customers" },
  equipment: { count: "pieces of equipment (active and inactive)" },
  memberships: {
    count: "memberships, by start year",
    dollars: "membership prices, by start year",
  },
  invoices: {
    count: "invoices, by business unit and invoice year",
    dollars: "invoice totals (with tax), by business unit and invoice year",
  },
  payments: {
    count: "payments and refunds, by the invoice's business unit and the year received",
    dollars: "payments minus refunds, by the invoice's business unit and the year received",
  },
  timesheets: { count: "time entries, by the job's business unit (none for shifts) and year" },
};

/** Ids of the records this batch's accepted rows point at, for one table. */
function accepted(batchId: string, table: string): SQL {
  return sql`(select distinct target_id::uuid as id from st_import_rows
    where batch_id = ${batchId} and target_table = ${table}
      and result in ('inserted', 'updated', 'unchanged'))`;
}

function countAll(batchId: string, table: string): SQL {
  return sql`select ${NO_BUSINESS_UNIT}::text as bu, ${ALL_YEARS}::int as year,
    count(*)::bigint as n, null::bigint as cents from ${accepted(batchId, table)} x`;
}

function totalsQuery(batchId: string, reportType: ReportType): SQL {
  const zone = BUSINESS_TIME_ZONE;
  switch (reportType) {
    case "technicians":
      return countAll(batchId, "employees");
    case "pricebook":
      return countAll(batchId, "pricebook_items");
    case "equipment":
      return countAll(batchId, "equipment");
    case "customers":
      return sql`select ${NO_BUSINESS_UNIT}::text as bu, ${ALL_YEARS}::int as year,
          count(distinct customer_id)::bigint as n, null::bigint as cents
        from (
          select x.id as customer_id from ${accepted(batchId, "customers")} x
          union all
          select l.customer_id from ${accepted(batchId, "locations")} x join locations l on l.id = x.id
          union all
          select c.customer_id from ${accepted(batchId, "contacts")} x join contacts c on c.id = x.id
        ) t`;
    case "memberships":
      return sql`select ${NO_BUSINESS_UNIT}::text as bu, extract(year from m.start_date)::int as year,
          count(*)::bigint as n, sum(m.price_cents)::bigint as cents
        from ${accepted(batchId, "memberships")} x join memberships m on m.id = x.id
        group by 1, 2`;
    case "invoices":
      return sql`select coalesce(bu.code, ${NO_BUSINESS_UNIT}) as bu,
          extract(year from i.invoice_date)::int as year,
          count(*)::bigint as n, sum(i.total_cents)::bigint as cents
        from (
          select il.invoice_id as id from ${accepted(batchId, "invoice_lines")} x
            join invoice_lines il on il.id = x.id
          union
          select x.id from ${accepted(batchId, "invoices")} x
        ) t
        join invoices i on i.id = t.id
        left join business_units bu on bu.id = i.business_unit_id
        group by 1, 2`;
    case "payments":
      return sql`select coalesce(bu.code, ${NO_BUSINESS_UNIT}) as bu,
          extract(year from (p.received_at at time zone ${zone}))::int as year,
          count(*)::bigint as n,
          sum(case when p.kind = 'payment' then p.amount_cents else -p.amount_cents end)::bigint as cents
        from ${accepted(batchId, "payments")} x
        join payments p on p.id = x.id
        join invoices i on i.id = p.invoice_id
        left join business_units bu on bu.id = i.business_unit_id
        group by 1, 2`;
    case "timesheets":
      return sql`select coalesce(bu.code, ${NO_BUSINESS_UNIT}) as bu,
          extract(year from (t.started_at at time zone ${zone}))::int as year,
          count(*)::bigint as n, null::bigint as cents
        from ${accepted(batchId, "time_entries")} x
        join time_entries t on t.id = x.id
        left join jobs j on j.id = t.job_id
        left join business_units bu on bu.id = j.business_unit_id
        group by 1, 2`;
  }
}

async function readTotals(db: Executor, batchId: string): Promise<TotalRow[]> {
  const rows = await db
    .select()
    .from(stImportTotals)
    .where(eq(stImportTotals.batchId, batchId))
    .orderBy(
      asc(stImportTotals.businessUnitCode),
      asc(stImportTotals.year),
      asc(stImportTotals.metric),
    );
  return rows.map((row) => ({
    businessUnitCode: row.businessUnitCode,
    year: row.year,
    metric: row.metric,
    ours: row.ours,
    servicetitanSummary: row.servicetitanSummary,
    diff: row.diff,
    note: row.note,
  }));
}

const diffSql = sql`case when ${stImportTotals.servicetitanSummary} is null then null
  else excluded.ours - ${stImportTotals.servicetitanSummary} end`;

/** computeTotals inside an open transaction (runImport calls this). */
export async function computeTotalsIn(
  tx: Executor,
  batchId: string,
  reportType: ReportType,
): Promise<TotalRow[]> {
  const result = await tx.execute<{
    bu: string;
    year: number | string;
    n: number | string;
    cents: number | string | null;
  }>(totalsQuery(batchId, reportType));
  const values: (typeof stImportTotals.$inferInsert)[] = [];
  for (const row of result) {
    const base = { batchId, businessUnitCode: row.bu, year: Number(row.year) };
    values.push({ ...base, metric: "count", ours: Number(row.n) });
    if (row.cents !== null) values.push({ ...base, metric: "dollars", ours: Number(row.cents) });
  }
  // Lines that no longer have anything behind them drop to zero.
  await tx
    .update(stImportTotals)
    .set({
      ours: 0,
      diff: sql`case when ${stImportTotals.servicetitanSummary} is null then null
        else 0 - ${stImportTotals.servicetitanSummary} end`,
    })
    .where(eq(stImportTotals.batchId, batchId));
  if (values.length > 0) {
    await tx
      .insert(stImportTotals)
      .values(values)
      .onConflictDoUpdate({
        target: [
          stImportTotals.batchId,
          stImportTotals.businessUnitCode,
          stImportTotals.year,
          stImportTotals.metric,
        ],
        set: {
          ours: sql`excluded.ours`,
          diff: diffSql,
          // A summary-only line that now has rows behind it is no longer "not in this import".
          note: sql`case when ${stImportTotals.note} = ${NOT_IN_IMPORT} then null
            else ${stImportTotals.note} end`,
        },
      });
  }
  return readTotals(tx, batchId);
}

async function batchReportType(db: Executor, batchId: string): Promise<ReportType> {
  const [batch] = await db
    .select({ reportType: stImportBatches.reportType, status: stImportBatches.status })
    .from(stImportBatches)
    .where(eq(stImportBatches.id, batchId));
  if (!batch) throw new StImportError(`Import batch ${batchId} not found.`);
  if (batch.status !== "imported" || !isReportType(batch.reportType)) {
    throw new StImportError(`Import batch ${batchId} was not imported (status ${batch.status}).`);
  }
  return batch.reportType;
}

/**
 * Recomputes our counts and dollar totals for a batch into st_import_totals
 * (per business unit and year), keeping any ServiceTitan summary already
 * entered and updating the differences.
 */
export async function computeTotals(options: {
  db: Executor;
  batchId: string;
}): Promise<TotalRow[]> {
  const { db, batchId } = options;
  return db.transaction(async (tx) => {
    const reportType = await batchReportType(tx, batchId);
    return computeTotalsIn(tx, batchId, reportType);
  });
}

/** One line of a ServiceTitan summary report, as shown there. */
export interface SummaryRow {
  /** ServiceTitan business unit name (or our code); blank or "none" for reports without one. */
  businessUnit?: string | null;
  /** Calendar year; blank for reports not split by year. */
  year?: number | null;
  /** How many (invoices, payments, customers ...). */
  count?: number | null;
  /** Dollar total as ServiceTitan shows it, e.g. "$12,345.67". */
  total?: string | null;
  /** Or the dollar total already in integer cents. */
  totalCents?: number | null;
}

export type ComparisonStatus = "match" | "differs" | "not_in_summary";

export interface ComparisonRow extends TotalRow {
  status: ComparisonStatus;
}

export interface Comparison {
  batchId: string;
  /** True when every line matches ServiceTitan's summary to the cent. */
  matches: boolean;
  rows: ComparisonRow[];
}

function summaryBusinessUnit(name: string | null | undefined): string {
  if (name === null || name === undefined) return NO_BUSINESS_UNIT;
  const label = normalizeLabel(name);
  if (label === "" || label === NO_BUSINESS_UNIT) return NO_BUSINESS_UNIT;
  const code = lookupValue(BUSINESS_UNIT_NAMES, name);
  if (!code) {
    throw new StImportError(
      `The summary names a business unit we don't know: "${name}". Add it to the business unit names in the mapping config.`,
    );
  }
  return code;
}

/** The summary as {businessUnit, year, metric} -> value, checked. */
function summaryValues(summary: readonly SummaryRow[]): Map<string, number> {
  const values = new Map<string, number>();
  const put = (bu: string, year: number, metric: StImportMetric, value: number) => {
    const key = JSON.stringify([bu, year, metric]);
    if (values.has(key)) {
      throw new StImportError(
        `The summary lists ${metric} for ${bu} ${year || "(all years)"} twice.`,
      );
    }
    values.set(key, value);
  };
  for (const row of summary) {
    const bu = summaryBusinessUnit(row.businessUnit);
    const year = row.year ?? ALL_YEARS;
    if (!Number.isInteger(year) || year < 0) {
      throw new StImportError(`The summary has a year that isn't a year: ${row.year}.`);
    }
    if (row.count !== null && row.count !== undefined) {
      if (!Number.isSafeInteger(row.count) || row.count < 0) {
        throw new StImportError(`The summary has a count that isn't a whole number: ${row.count}.`);
      }
      put(bu, year, "count", row.count);
    }
    let cents: number | null = null;
    if (row.totalCents !== null && row.totalCents !== undefined) {
      if (!Number.isSafeInteger(row.totalCents)) {
        throw new StImportError(
          `The summary has totalCents that isn't whole cents: ${row.totalCents}.`,
        );
      }
      cents = row.totalCents;
    } else if (row.total !== null && row.total !== undefined && row.total.trim() !== "") {
      try {
        cents = parseMoney(row.total);
      } catch {
        throw new StImportError(`The summary has a total that isn't money: "${row.total}".`);
      }
    }
    if (cents !== null) put(bu, year, "dollars", cents);
  }
  return values;
}

function statusOf(row: TotalRow): ComparisonStatus {
  if (row.servicetitanSummary === null) return "not_in_summary";
  return row.diff === 0 ? "match" : "differs";
}

/**
 * Puts ServiceTitan's own summary totals next to ours for a batch and
 * records the differences in st_import_totals. Lines only in the summary are
 * added with ours = 0; lines only in ours are marked "not in summary".
 * Calling it again replaces the previous summary.
 */
export async function compareWithSummary(options: {
  db: Executor;
  batchId: string;
  summary: readonly SummaryRow[];
}): Promise<Comparison> {
  const { db, batchId } = options;
  const values = summaryValues(options.summary);
  return db.transaction(async (tx) => {
    await batchReportType(tx, batchId);
    await tx
      .update(stImportTotals)
      .set({ servicetitanSummary: null, diff: null, note: null })
      .where(eq(stImportTotals.batchId, batchId));
    for (const [key, value] of values) {
      const [businessUnitCode, year, metric] = JSON.parse(key) as [string, number, StImportMetric];
      await tx
        .insert(stImportTotals)
        .values({
          batchId,
          businessUnitCode,
          year,
          metric,
          ours: 0,
          servicetitanSummary: value,
          diff: -value,
          note: NOT_IN_IMPORT,
        })
        .onConflictDoUpdate({
          target: [
            stImportTotals.batchId,
            stImportTotals.businessUnitCode,
            stImportTotals.year,
            stImportTotals.metric,
          ],
          set: {
            servicetitanSummary: value,
            diff: sql`${stImportTotals.ours} - ${value}`,
            note: null,
          },
        });
    }
    await tx
      .update(stImportTotals)
      .set({ note: NOT_IN_SUMMARY })
      .where(and(eq(stImportTotals.batchId, batchId), isNull(stImportTotals.servicetitanSummary)));
    const rows = (await readTotals(tx, batchId)).map((row) => ({ ...row, status: statusOf(row) }));
    return {
      batchId,
      matches: rows.every(
        (row) => row.status === "match" || (row.status === "not_in_summary" && row.ours === 0),
      ),
      rows,
    };
  });
}
