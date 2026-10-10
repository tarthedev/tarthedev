import { formatCents, mulDivHalfUp } from "@dwrg/core";
import {
  type BillingStage,
  type BusinessUnitCode,
  type InvoiceStatus,
  invoiceLines,
  invoices,
  type JobPriority,
  type JobStatus,
  jobCosts,
  jobs,
  type PricebookKind,
  type UpsertResult,
} from "@dwrg/db";
import { and, eq, isNull } from "drizzle-orm";
import { type GroupScope, type RowOutcome, rowResult } from "../context";
import { RowError } from "../errors";
import type { Lookups } from "../lookups";
import { invoicesMapping } from "../mappings/invoices";
import {
  BILLING_STAGE_NAMES,
  BUSINESS_UNIT_NAMES,
  INVOICE_STATUS_NAMES,
  JOB_PRIORITY_NAMES,
  JOB_STATUS_NAMES,
  PRICEBOOK_KIND_NAMES,
} from "../mappings/values";
import type { Quantity, RowReader } from "../reader";
import { zonedTimeToInstant } from "../time";
import { type Claim, type ColumnLabel, defineHandler, type ParsedRow } from "./types";

type InvoiceField = keyof typeof invoicesMapping.fields;

export interface JobPart {
  stId: string;
  customerStId: string;
  locationStId: string;
  businessUnit: BusinessUnitCode;
  jobType: string;
  summary: string | null | undefined;
  status: JobStatus;
  priority: JobPriority | undefined;
  source: string | null | undefined;
  bookedBy: string | null | undefined;
  bookedAt: Date | null | undefined;
  finishedAt: Date | null | undefined;
  soldBy: string | null | undefined;
  leadBy: string | null | undefined;
  recallFor: string | null | undefined;
  recallTechCaused: boolean | null | undefined;
  recallReason: string | null | undefined;
  poNumber: string | null | undefined;
}

export interface InvoicePart {
  stId: string;
  jobStId: string | null;
  customerStId: string;
  locationStId: string | null | undefined;
  businessUnit: BusinessUnitCode;
  invoiceDate: string;
  dueDate: string | null | undefined;
  status: InvoiceStatus | "balance" | null | undefined;
  billingStage: BillingStage | null | undefined;
  summary: string | null | undefined;
  /** As exported; filled in from the line items when the file has no such column. */
  subtotalCents: number | undefined;
  discountCents: number | undefined;
  taxCents: number | undefined;
  totalCents: number;
  balanceCents: number;
  paidAt: Date | null | undefined;
  poNumber: string | null | undefined;
}

export interface LinePart {
  /** Invoice Item ID, or "<invoice #>-L<line #>" when the export has no line IDs. */
  stId: string;
  explicitStId: string | null | undefined;
  lineNumber: number | null | undefined;
  /** 1-based position among the invoice's line rows in the file. */
  position: number;
  itemCode: string | null | undefined;
  itemKind: PricebookKind | null | undefined;
  description: string;
  quantity: Quantity;
  unitPriceCents: number;
  /** round_half_up(quantity x unit price). */
  grossCents: number;
  discountCents: number;
  /** gross - discount. */
  amountCents: number;
  taxable: boolean;
  taxCents: number;
  /** Extended cost of the line. */
  costCents: number;
  discountGiven: boolean;
  taxGiven: boolean;
}

export interface InvoiceRow {
  job: JobPart | null;
  invoice: InvoicePart | null;
  line: LinePart | null;
}

const LINE_FIELDS = [
  "lineId",
  "itemCode",
  "description",
  "quantity",
  "unitPrice",
  "lineAmount",
  "lineDiscount",
  "lineTax",
  "cost",
] as const satisfies readonly InvoiceField[];

/** "No Heat" -> "no_heat". */
export function jobTypeCode(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "other"
  );
}

function nonNegative(
  r: RowReader<InvoiceField>,
  field: InvoiceField,
  value: number | null | undefined,
) {
  if (typeof value === "number" && value < 0) r.fail(field, `${r.label(field)} is negative.`);
}

function readJob(
  r: RowReader<InvoiceField>,
  stId: string,
  customerStId: string,
  locationStId: string | null | undefined,
  businessUnit: BusinessUnitCode,
): JobPart {
  const finishedAt = r.instant("completedOn");
  const statusCell = r.choice("jobStatus", JOB_STATUS_NAMES);
  const status: JobStatus = statusCell ?? (finishedAt ? "done" : "scheduled");
  if (status === "done" && !finishedAt && (r.cell("completedOn") ?? "") === "") {
    r.fail("completedOn", `${r.label("completedOn")} is blank for a completed job.`);
  }
  const jobType = r.text("jobType");
  return {
    stId,
    customerStId,
    // A job always has a service location.
    locationStId: r.need("locationId", locationStId, ""),
    businessUnit,
    jobType: jobType ? jobTypeCode(jobType) : "other",
    summary: r.text("jobSummary"),
    status,
    priority: r.choice("priority", JOB_PRIORITY_NAMES) ?? undefined,
    source: r.text("jobSource"),
    bookedBy: r.text("bookedBy"),
    bookedAt: r.instant("bookedOn"),
    finishedAt,
    soldBy: r.text("soldBy"),
    leadBy: r.text("leadBy"),
    recallFor: r.id("recallFor"),
    recallTechCaused: r.bool("recallTechCaused"),
    recallReason: r.text("recallReason"),
    poNumber: r.text("poNumber"),
  };
}

function readInvoice(
  r: RowReader<InvoiceField>,
  stId: string,
  jobStId: string | null,
  customerStId: string,
  locationStId: string | null | undefined,
  businessUnit: BusinessUnitCode,
): InvoicePart {
  const subtotalCents = r.money("subtotal");
  const discountCents = r.money("discount");
  const taxCents = r.money("tax");
  nonNegative(r, "discount", discountCents);
  nonNegative(r, "tax", taxCents);
  return {
    stId,
    jobStId,
    customerStId,
    locationStId,
    businessUnit,
    invoiceDate: r.requiredDate("invoiceDate"),
    dueDate: r.date("dueDate"),
    status: r.choice("invoiceStatus", INVOICE_STATUS_NAMES),
    billingStage: r.choice("billingStage", BILLING_STAGE_NAMES),
    summary: r.text("invoiceSummary"),
    subtotalCents: subtotalCents ?? undefined,
    discountCents: discountCents ?? undefined,
    taxCents: taxCents ?? undefined,
    totalCents: r.requiredMoney("total"),
    balanceCents: r.requiredMoney("balance"),
    paidAt: r.instant("paidOn"),
    poNumber: r.text("poNumber"),
  };
}

function readLine(r: RowReader<InvoiceField>): LinePart {
  const quantity = r.has("quantity")
    ? r.need("quantity", r.quantity("quantity"), { text: "1.000", milli: 1000 })
    : { text: "1.000", milli: 1000 };
  const unitPriceCents = r.requiredMoney("unitPrice");
  const discount = r.money("lineDiscount");
  const tax = r.money("lineTax");
  const cost = r.money("cost");
  nonNegative(r, "lineDiscount", discount);
  nonNegative(r, "lineTax", tax);
  const grossCents = r.ok ? mulDivHalfUp(quantity.milli, unitPriceCents, 1000) : 0;
  const discountCents = discount ?? 0;
  const amountCents = grossCents - discountCents;
  const given = r.money("lineAmount");
  if (typeof given === "number" && r.ok && given !== amountCents) {
    r.fail(
      "lineAmount",
      `${r.label("lineAmount")} is ${formatCents(given)}, but ${r.label("quantity")} × ${r.label("unitPrice")} − ${r.label("lineDiscount")} is ${formatCents(amountCents)}.`,
    );
  }
  const itemCode = r.text("itemCode");
  const description = r.text("description") ?? itemCode ?? r.need("description", null, "");
  const taxable = r.bool("taxable");
  return {
    stId: "",
    explicitStId: r.id("lineId"),
    lineNumber: r.int("lineNumber", 0),
    position: 0,
    itemCode,
    itemKind: r.choice("itemType", PRICEBOOK_KIND_NAMES),
    description,
    quantity,
    unitPriceCents,
    grossCents,
    discountCents,
    amountCents,
    taxable: taxable ?? (tax ?? 0) > 0,
    taxCents: tax ?? 0,
    costCents: cost ?? 0,
    discountGiven: discount !== undefined,
    taxGiven: tax !== undefined,
  };
}

/** The references a row needs, resolved (throws RowError when one is missing). */
function resolveRefs(lookups: Lookups, row: InvoiceRow, column: ColumnLabel<InvoiceField>) {
  const head = row.job ?? row.invoice;
  if (!head) return null;
  const person = (value: string | null | undefined, field: InvoiceField) =>
    value === undefined || value === null ? value : lookups.person(value, column(field));
  if (row.job) {
    lookups.notOwnedHere("jobs", row.job.stId, column("jobNumber"));
    lookups.numberFree("job", row.job.stId, row.job.stId, column("jobNumber"));
  }
  if (row.invoice) {
    lookups.notOwnedHere("invoices", row.invoice.stId, column("invoiceNumber"));
    lookups.numberFree("invoice", row.invoice.stId, row.invoice.stId, column("invoiceNumber"));
  }
  const locationStId = row.job?.locationStId ?? row.invoice?.locationStId;
  return {
    customerId: lookups.customer(head.customerStId, column("customerId")),
    locationId:
      locationStId === undefined || locationStId === null
        ? locationStId
        : lookups.location(locationStId, column("locationId")).id,
    businessUnitId: lookups.businessUnit(head.businessUnit),
    bookedByUserId: person(row.job?.bookedBy, "bookedBy"),
    soldByUserId: person(row.job?.soldBy, "soldBy"),
    leadSourceUserId: person(row.job?.leadBy, "leadBy"),
    callbackOfJobId:
      row.job?.recallFor === undefined || row.job.recallFor === null
        ? row.job?.recallFor
        : lookups.job(row.job.recallFor, column("recallFor")),
  };
}

/**
 * Jobs and invoices with line items and line costs. All rows of one invoice
 * import together: its header must agree on every row, the line items must
 * add up to the header, and Total must equal Subtotal − Discount + Tax.
 * Each line's cost is the line's `cost_cents` and, when the invoice has a
 * job, a job cost (source invoice_line). A line that disappears from an
 * invoice in ServiceTitan is soft-deleted here on the next import.
 */
export const invoicesHandler = defineHandler({
  mapping: invoicesMapping,

  parse(r): InvoiceRow {
    const jobStId = r.id("jobNumber") ?? null;
    const invoiceStId = r.id("invoiceNumber") ?? null;
    const hasLine = LINE_FIELDS.some((field) => (r.cell(field) ?? "") !== "");
    if (!jobStId && !invoiceStId) {
      r.fail(
        "invoiceNumber",
        `${r.label("invoiceNumber")} and ${r.label("jobNumber")} are both blank.`,
      );
      return { job: null, invoice: null, line: null };
    }
    if (hasLine && !invoiceStId) {
      r.fail(
        "invoiceNumber",
        `This row has line item details but ${r.label("invoiceNumber")} is blank.`,
      );
    }
    const customerStId = r.requiredId("customerId");
    const locationStId = r.id("locationId");
    const businessUnit = r.requiredChoice("businessUnit", BUSINESS_UNIT_NAMES, "hvac_service");
    return {
      job: jobStId ? readJob(r, jobStId, customerStId, locationStId, businessUnit) : null,
      invoice: invoiceStId
        ? readInvoice(r, invoiceStId, jobStId, customerStId, locationStId, businessUnit)
        : null,
      line: invoiceStId && hasLine ? readLine(r) : null,
    };
  },

  finalize(rows) {
    const positions = new Map<string, number>();
    for (const { value } of rows) {
      if (!value.invoice || !value.line) continue;
      const position = (positions.get(value.invoice.stId) ?? 0) + 1;
      positions.set(value.invoice.stId, position);
      value.line.position = position;
      value.line.stId =
        value.line.explicitStId ?? `${value.invoice.stId}-L${value.line.lineNumber ?? position}`;
    }
  },

  stIdOf: (row) => row.line?.stId ?? row.invoice?.stId ?? row.job?.stId ?? null,

  claims(row) {
    const claims: Claim[] = [];
    if (row.job) {
      claims.push({
        key: `jobs:${row.job.stId}`,
        label: `Job ${row.job.stId}`,
        details: { ...row.job },
      });
    }
    if (row.invoice) {
      claims.push({
        key: `invoices:${row.invoice.stId}`,
        label: `Invoice ${row.invoice.stId}`,
        details: { ...row.invoice },
      });
    }
    if (row.line) {
      const { position: _position, ...line } = row.line;
      claims.push({
        key: `invoice_lines:${row.line.stId}`,
        label: `Line ${row.line.stId}`,
        details: { invoice: row.invoice?.stId, ...line },
      });
    }
    return claims;
  },

  groupKey: (row) =>
    row.invoice ? `invoice:${row.invoice.stId}` : row.job ? `job:${row.job.stId}` : null,

  groupLabel: (row) => (row.invoice ? `invoice ${row.invoice.stId}` : `job ${row.job?.stId}`),

  orderGroups(groups) {
    // A callback refers to its original job, so the original imports first
    // even when the export lists it later (exports are often newest first).
    const definedBy = new Map<string, number>();
    groups.forEach((group, index) => {
      for (const row of group) {
        const stId = row.value.job?.stId;
        if (stId && !definedBy.has(stId)) definedBy.set(stId, index);
      }
    });
    const order = dependencyOrder(groups.length, (index) =>
      (groups[index] ?? []).flatMap((row) => {
        const ref = row.value.job?.recallFor;
        const dependency = ref ? definedBy.get(ref) : undefined;
        return dependency === undefined || dependency === index ? [] : [dependency];
      }),
    );
    return order.flatMap((index) => {
      const group = groups[index];
      return group ? [group] : [];
    });
  },

  checkGroup(rows, column) {
    const first = rows[0];
    const head = first?.value.invoice;
    if (!first || !head) return;
    const fail = (message: string, field: InvoiceField) =>
      first.issues.push({ column: column(field), message });

    const lines = rows.flatMap((row) => (row.value.line ? [row.value.line] : []));
    const seen = new Set<string>();
    for (const row of rows) {
      const line = row.value.line;
      if (!line) continue;
      if (seen.has(line.stId)) {
        row.issues.push({
          column: column("lineId"),
          message: `Line ${line.stId} appears twice in invoice ${head.stId}.`,
        });
      }
      seen.add(line.stId);
    }
    const sum = (pick: (line: LinePart) => number) => lines.reduce((t, l) => t + pick(l), 0);
    const gross = sum((l) => l.grossCents);
    const lineDiscount = sum((l) => l.discountCents);
    const lineTax = sum((l) => l.taxCents);
    const hasLines = lines.length > 0;

    if (hasLines && head.subtotalCents !== undefined && head.subtotalCents !== gross) {
      fail(
        `${column("subtotal")} is ${formatCents(head.subtotalCents)}, but the line items add up to ${formatCents(gross)} (${column("quantity")} × ${column("unitPrice")}).`,
        "subtotal",
      );
    }
    if (
      hasLines &&
      head.discountCents !== undefined &&
      lines.every((l) => l.discountGiven) &&
      head.discountCents !== lineDiscount
    ) {
      fail(
        `${column("discount")} is ${formatCents(head.discountCents)}, but the line item discounts add up to ${formatCents(lineDiscount)}.`,
        "discount",
      );
    }
    if (
      hasLines &&
      head.taxCents !== undefined &&
      lines.every((l) => l.taxGiven) &&
      head.taxCents !== lineTax
    ) {
      fail(
        `${column("tax")} is ${formatCents(head.taxCents)}, but the line item taxes add up to ${formatCents(lineTax)}.`,
        "tax",
      );
    }
    const discount = head.discountCents ?? (hasLines ? lineDiscount : 0);
    const tax = head.taxCents ?? (hasLines ? lineTax : 0);
    const subtotal = head.subtotalCents ?? (hasLines ? gross : head.totalCents + discount - tax);
    if (subtotal - discount + tax !== head.totalCents) {
      fail(
        `${column("total")} is ${formatCents(head.totalCents)}, but ${column("subtotal")} − ${column("discount")} + ${column("tax")} is ${formatCents(subtotal - discount + tax)}.`,
        "total",
      );
    }
    for (const row of rows) {
      const invoice = row.value.invoice;
      if (!invoice) continue;
      invoice.subtotalCents = subtotal;
      invoice.discountCents = discount;
      invoice.taxCents = tax;
    }
  },

  businessUnits(row) {
    const head = row.job ?? row.invoice;
    return head ? [head.businessUnit] : [];
  },

  async load(lookups, rows) {
    await lookups.loadBusinessUnits();
    await lookups.loadPeople();
    await lookups.loadPricebook();
    await lookups.loadCustomers(rows.map((row) => (row.job ?? row.invoice)?.customerStId));
    await lookups.loadLocations(
      rows.flatMap((row) => [row.job?.locationStId, row.invoice?.locationStId]),
    );
    await lookups.loadJobs(rows.flatMap((row) => [row.job?.stId, row.job?.recallFor]));
    await lookups.loadInvoices(rows.map((row) => row.invoice?.stId));
    await lookups.loadJobNumbers(rows.map((row) => row.job?.stId));
    await lookups.loadInvoiceNumbers(rows.map((row) => row.invoice?.stId));
  },

  defines(lookups, row) {
    if (row.job) lookups.pending.jobs.add(row.job.stId);
  },

  check(lookups, row, column) {
    resolveRefs(lookups, row, column);
  },

  importGroup: (scope, rows, column) => importInvoiceGroup(scope, rows, column),
});

/**
 * Indexes 0..count-1 ordered so each comes after the indexes it depends on,
 * otherwise in their original order. A cycle (which a valid export can't
 * have) is broken where it is found.
 */
export function dependencyOrder(count: number, dependsOn: (index: number) => number[]): number[] {
  const NEW = 0;
  const VISITING = 1;
  const DONE = 2;
  const state = new Uint8Array(count);
  const order: number[] = [];
  for (let start = 0; start < count; start++) {
    if (state[start] !== NEW) continue;
    state[start] = VISITING;
    const stack = [{ index: start, pending: dependsOn(start).reverse() }];
    while (stack.length > 0) {
      const top = stack.at(-1);
      if (!top) break;
      const next = top.pending.pop();
      if (next === undefined) {
        stack.pop();
        state[top.index] = DONE;
        order.push(top.index);
      } else if (next >= 0 && next < count && state[next] === NEW) {
        state[next] = VISITING;
        stack.push({ index: next, pending: dependsOn(next).reverse() });
      }
    }
  }
  return order;
}

async function importInvoiceGroup(
  scope: GroupScope,
  rows: readonly ParsedRow<InvoiceRow>[],
  column: ColumnLabel<InvoiceField>,
): Promise<RowOutcome[]> {
  const first = rows[0];
  if (!first) return [];
  const { lookups } = scope;
  const { job, invoice } = first.value;
  const refs = resolveRefs(lookups, first.value, column);
  if (!refs) throw new RowError("The row has neither a job nor an invoice.");

  let jobResult: { id: string; result: UpsertResult } | null = null;
  if (job) {
    if (!refs.locationId) throw new RowError("A job needs a Location ID.", first.rowNumber);
    jobResult = await scope.upsert(jobs, jobs.stId, job.stId, {
      stId: job.stId,
      origin: "servicetitan",
      number: job.stId,
      customerId: refs.customerId,
      locationId: refs.locationId,
      businessUnitId: refs.businessUnitId,
      jobType: job.jobType,
      summary: job.summary,
      priority: job.priority,
      status: job.status,
      source: job.source,
      bookedByUserId: refs.bookedByUserId,
      bookedAt: job.bookedAt,
      poNumber: job.poNumber,
      finishedAt: job.finishedAt,
      soldByUserId: refs.soldByUserId,
      leadSourceUserId: refs.leadSourceUserId,
      callbackOfJobId: refs.callbackOfJobId,
      callbackTechCaused: job.recallTechCaused,
      callbackReason: job.recallReason,
    });
    const jobId = jobResult.id;
    scope.onCommit(() => lookups.jobs.set(job.stId, jobId));
  }

  const outcomes: RowOutcome[] = [];
  if (!invoice) {
    outcomes.push({
      rowNumber: first.rowNumber,
      result: jobResult?.result ?? "unchanged",
      stId: job?.stId ?? null,
      targetTable: "jobs",
      targetId: jobResult?.id ?? null,
      error: null,
    });
    return outcomes;
  }

  const jobId = jobResult?.id ?? null;
  const status: InvoiceStatus =
    invoice.status === undefined || invoice.status === null || invoice.status === "balance"
      ? invoice.balanceCents === 0
        ? "paid"
        : "open"
      : invoice.status;
  const invoiceResult = await scope.upsert(invoices, invoices.stId, invoice.stId, {
    stId: invoice.stId,
    origin: "servicetitan",
    number: invoice.stId,
    jobId,
    customerId: refs.customerId,
    locationId: refs.locationId,
    businessUnitId: refs.businessUnitId,
    status,
    invoiceDate: invoice.invoiceDate,
    dueDate: invoice.dueDate,
    subtotalCents: invoice.subtotalCents ?? 0,
    discountCents: invoice.discountCents ?? 0,
    taxCents: invoice.taxCents ?? 0,
    totalCents: invoice.totalCents,
    balanceCents: invoice.balanceCents,
    poNumber: invoice.poNumber,
    billingStage: invoice.billingStage,
    paidInFullAt: invoice.paidAt,
    summary: invoice.summary,
  });
  const invoiceId = invoiceResult.id;

  // Costs are incurred when the job finished, or on the invoice date if it hasn't.
  const incurredAt =
    job?.finishedAt ??
    zonedTimeToInstant({ date: invoice.invoiceDate, hour: 0, minute: 0, second: 0 });
  const kept = new Set<string>();
  for (const [index, row] of rows.entries()) {
    const line = row.value.line;
    const extras: (UpsertResult | null)[] = index === 0 ? [jobResult?.result ?? null] : [];
    if (!line) {
      outcomes.push({
        rowNumber: row.rowNumber,
        result: rowResult(invoiceResult.result, extras),
        stId: invoice.stId,
        targetTable: "invoices",
        targetId: invoiceId,
        error: null,
      });
      continue;
    }
    if (index === 0) extras.push(invoiceResult.result);
    kept.add(line.stId);
    const item = line.itemCode ? lookups.pricebookByCode.get(line.itemCode) : undefined;
    const lineResult = await scope.upsert(invoiceLines, invoiceLines.stId, line.stId, {
      stId: line.stId,
      invoiceId,
      pricebookItemId: line.itemCode === undefined ? undefined : (item?.id ?? null),
      sortOrder: line.lineNumber ?? line.position,
      description: line.description,
      quantity: line.quantity.text,
      unitPriceCents: line.unitPriceCents,
      discountCents: line.discountCents,
      amountCents: line.amountCents,
      taxable: line.taxable,
      taxCents: line.taxCents,
      costCents: line.costCents,
      deletedAt: null,
    });
    if (jobId) {
      extras.push(
        await upsertLineCost(scope, {
          stId: lineCostStId(line.stId),
          lineId: lineResult.id,
          lineIsNew: lineResult.result === "inserted",
          jobId,
          kind: (line.itemKind ?? item?.kind) === "equipment" ? "equipment" : "parts",
          amountCents: line.costCents,
          description: line.description,
          incurredAt,
        }),
      );
    }
    outcomes.push({
      rowNumber: row.rowNumber,
      result: rowResult(lineResult.result, extras),
      stId: line.stId,
      targetTable: "invoice_lines",
      targetId: lineResult.id,
      error: null,
    });
  }

  if (invoiceResult.result !== "inserted") {
    const removed = await removeMissingLines(scope, invoiceId, kept);
    const firstOutcome = outcomes[0];
    if (removed > 0 && firstOutcome && firstOutcome.result === "unchanged") {
      firstOutcome.result = "updated";
    }
  }
  return outcomes;
}

/** ServiceTitan key of the job cost made from a line's cost (a line has at most one). */
export function lineCostStId(lineStId: string): string {
  return `${lineStId}/cost`;
}

/**
 * The job cost for a line's cost, keyed on the line's ServiceTitan ID, so a
 * re-import updates it in place. A zero cost writes nothing for a new line
 * and zeroes the existing cost of a line that had one.
 */
async function upsertLineCost(
  scope: GroupScope,
  cost: {
    stId: string;
    lineId: string;
    lineIsNew: boolean;
    jobId: string;
    kind: "parts" | "equipment";
    amountCents: number;
    description: string;
    incurredAt: Date;
  },
): Promise<UpsertResult | null> {
  if (cost.amountCents === 0 && (cost.lineIsNew || !(await jobCostExists(scope, cost.stId)))) {
    return null;
  }
  const { result } = await scope.upsert(jobCosts, jobCosts.stId, cost.stId, {
    stId: cost.stId,
    jobId: cost.jobId,
    kind: cost.kind,
    amountCents: cost.amountCents,
    source: "invoice_line",
    sourceId: cost.lineId,
    description: cost.description,
    incurredAt: cost.incurredAt,
    deletedAt: null,
  });
  return result;
}

/** Whether a job cost with this ServiceTitan key exists (deleted or not). */
export async function jobCostExists(scope: GroupScope, stId: string): Promise<boolean> {
  if (scope.writtenRow(jobCosts, stId)) return true;
  const [existing] = await scope.tx
    .select({ id: jobCosts.id })
    .from(jobCosts)
    .where(eq(jobCosts.stId, stId))
    .limit(1);
  return existing !== undefined;
}

/** Soft-deletes lines (and their costs) that are no longer on the invoice in ServiceTitan. */
async function removeMissingLines(
  scope: GroupScope,
  invoiceId: string,
  kept: ReadonlySet<string>,
): Promise<number> {
  const current = await scope.tx
    .select({ id: invoiceLines.id, stId: invoiceLines.stId })
    .from(invoiceLines)
    .where(and(eq(invoiceLines.invoiceId, invoiceId), isNull(invoiceLines.deletedAt)));
  let removed = 0;
  for (const line of current) {
    if (line.stId && kept.has(line.stId)) continue;
    const reason = "line no longer on the ServiceTitan invoice";
    await scope.softDelete(invoiceLines, line.id, reason);
    const costs = await scope.tx
      .select({ id: jobCosts.id })
      .from(jobCosts)
      .where(
        and(
          eq(jobCosts.source, "invoice_line"),
          eq(jobCosts.sourceId, line.id),
          isNull(jobCosts.deletedAt),
        ),
      );
    for (const cost of costs) await scope.softDelete(jobCosts, cost.id, reason);
    removed++;
  }
  return removed;
}
