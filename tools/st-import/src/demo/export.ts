import { formatCents } from "@dwrg/core";
import {
  DEMO_SEED,
  type DemoData,
  type DemoOptions,
  generateDemoData,
  summarizeDemoData,
} from "@dwrg/db/demo";
import { toCsv } from "../csv";
import { MAPPINGS } from "../mappings";
import type { ReportMapping, ReportType } from "../mappings/types";
import {
  BILLING_STAGE_NAMES,
  BUSINESS_UNIT_NAMES,
  CUSTOMER_TYPE_NAMES,
  EQUIPMENT_KIND_NAMES,
  INVOICE_STATUS_NAMES,
  JOB_PRIORITY_NAMES,
  JOB_STATUS_NAMES,
  labelOf,
  MEMBERSHIP_STATUS_NAMES,
  PAYMENT_METHOD_NAMES,
  PRICEBOOK_KIND_NAMES,
  ROLE_NAMES,
  SKILL_NAMES,
  TIME_ENTRY_KIND_NAMES,
} from "../mappings/values";
import { formatUsDate, formatUsDateTime, localYearOf, yearOfLocalDate } from "../time";
import type { SummaryRow } from "../totals";

/**
 * Demo ServiceTitan report exports (owner decision: no real data yet),
 * written from @dwrg/db's deterministic demo data. Small on purpose: eight
 * weeks across a New Year so totals split by year, with every payment
 * method, callbacks, replacements, progress billing and open invoices.
 * Headers are the first header of each field in the mapping config.
 */
export const DEMO_EXPORT_OPTIONS = {
  seed: DEMO_SEED,
  endDate: "2026-01-11",
  weeks: 8,
  customers: 60,
} as const satisfies DemoOptions;

/** File name of each report in fixtures/demo. */
export const DEMO_FILE_NAMES: Readonly<Record<ReportType, string>> = {
  technicians: "technicians.csv",
  pricebook: "pricebook.csv",
  customers: "customers.csv",
  equipment: "equipment.csv",
  memberships: "memberships.csv",
  invoices: "invoices.csv",
  payments: "payments.csv",
  timesheets: "timesheets.csv",
};
export const DEMO_SUMMARY_FILE = "summary.json";

/** ServiceTitan-style summary totals for the demo exports (what their summary reports would show). */
export interface DemoSummaryFile {
  about: string;
  generatedFrom: typeof DEMO_EXPORT_OPTIONS;
  demoTotals: {
    invoiceTotalCents: number;
    openBalanceCents: number;
    paymentsCents: number;
    fingerprint: string;
  };
  reports: Record<ReportType, SummaryRow[]>;
}

export interface DemoExports {
  /** CSV text per report type. */
  files: Record<ReportType, string>;
  summary: DemoSummaryFile;
}

type Cell = string | number | boolean | null | undefined;

function sheet<F extends string>(
  mapping: ReportMapping<F>,
  fields: readonly F[],
  rows: readonly Partial<Record<F, Cell>>[],
): string {
  const headers = fields.map((field) => mapping.fields[field].headers[0] ?? field);
  return toCsv(
    headers,
    rows.map((row) => fields.map((field) => cellText(row[field]))),
  );
}

function cellText(value: Cell): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

const money = (cents: number | null | undefined) =>
  cents === null || cents === undefined ? "" : formatCents(cents);
const usDate = (date: string | null | undefined) => (date ? formatUsDate(date) : "");
const usDateTime = (instant: Date | null | undefined) => (instant ? formatUsDateTime(instant) : "");

/** "+12525550123" -> "(252) 555-0123", how ServiceTitan shows phones. */
function usPhone(phone: string | null | undefined): string {
  const match = phone ? /^\+1(\d{3})(\d{3})(\d{4})$/.exec(phone) : null;
  return match ? `(${match[1]}) ${match[2]}-${match[3]}` : (phone ?? "");
}

/** Whole minutes as decimal hours with up to 4 places (45 -> "0.75", 50 -> "0.8333"). */
function hours(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "";
  const tenThousandths = Math.floor((minutes * 10_000 * 2 + 60) / 120);
  const whole = Math.floor(tenThousandths / 10_000);
  const fraction = String(tenThousandths % 10_000)
    .padStart(4, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

/** "no_heat" -> "No Heat". */
function titleCase(code: string): string {
  return code
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** "2.000" -> "2"; "1.500" -> "1.5". */
function quantityText(quantity: string | null | undefined): string {
  if (!quantity) return "1";
  return quantity.includes(".") ? quantity.replace(/\.?0+$/, "") : quantity;
}

function byId<T extends { id: string }>(rows: readonly T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.id, row]));
}

function need<T>(map: Map<string, T>, id: string | null | undefined, what: string): T {
  const found = id ? map.get(id) : undefined;
  if (!found) throw new Error(`Demo data has no ${what} ${id}`);
  return found;
}

/** Builds every demo report export and the summary totals from demo data. */
export function buildDemoExports(
  data: DemoData = generateDemoData(DEMO_EXPORT_OPTIONS),
): DemoExports {
  const users = byId(data.users);
  const customers = byId(data.customers);
  const locations = byId(data.locations);
  const jobs = byId(data.jobs);
  const invoices = byId(data.invoices);
  const businessUnits = byId(data.businessUnits);
  const employeeStIdOf = new Map(data.employees.map((e) => [e.userId, e.stId ?? ""]));
  const techId = (userId: string | null | undefined) =>
    userId ? (employeeStIdOf.get(userId) ?? "") : "";
  const buLabel = (id: string | null | undefined) =>
    id ? labelOf(BUSINESS_UNIT_NAMES, need(businessUnits, id, "business unit").code) : "";
  const plans = byId(data.membershipPlans);
  const items = byId(data.pricebookItems);

  const files = {} as Record<ReportType, string>;

  // --- technicians -----------------------------------------------------------
  const t = MAPPINGS.technicians.fields;
  files.technicians = sheet(
    MAPPINGS.technicians as ReportMapping<keyof typeof t>,
    [
      "technicianId",
      "name",
      "email",
      "phone",
      "role",
      "businessUnits",
      "skills",
      "hireDate",
      "active",
    ],
    data.employees.map((e) => {
      const u = need(users, e.userId, "user");
      return {
        technicianId: e.stId,
        name: u.name,
        email: u.email,
        phone: usPhone(e.phone),
        role: labelOf(ROLE_NAMES, u.role ?? "tech"),
        businessUnits: (e.businessUnits ?? [])
          .map((c) => labelOf(BUSINESS_UNIT_NAMES, c))
          .join(", "),
        skills: (e.skills ?? []).map((s) => labelOf(SKILL_NAMES, s)).join(", "),
        hireDate: usDate(e.hiredOn),
        active: u.active ?? true,
      };
    }),
  );

  // --- pricebook -------------------------------------------------------------
  const p = MAPPINGS.pricebook.fields;
  files.pricebook = sheet(
    MAPPINGS.pricebook as ReportMapping<keyof typeof p>,
    [
      "itemId",
      "code",
      "name",
      "itemType",
      "category",
      "description",
      "price",
      "memberPrice",
      "cost",
      "hours",
      "taxable",
      "active",
    ],
    data.pricebookItems.map((item) => ({
      itemId: item.stId,
      code: item.code,
      name: item.name,
      itemType: labelOf(PRICEBOOK_KIND_NAMES, item.kind),
      category: item.category,
      description: item.description,
      price: money(item.priceCents),
      memberPrice: money(item.memberPriceCents),
      cost: money(item.costCents ?? 0),
      hours: hours(item.estMinutes),
      taxable: item.taxable ?? false,
      active: item.active ?? true,
    })),
  );

  // --- customers, locations and contacts --------------------------------------
  const c = MAPPINGS.customers.fields;
  type CustomerField = keyof typeof c;
  const locationsOf = new Map<string, DemoData["locations"]>();
  for (const l of data.locations) {
    locationsOf.set(l.customerId, [...(locationsOf.get(l.customerId) ?? []), l]);
  }
  const contactsOf = new Map<string, DemoData["contacts"]>();
  for (const ct of data.contacts) {
    const key = ct.locationId ?? `customer:${ct.customerId}`;
    contactsOf.set(key, [...(contactsOf.get(key) ?? []), ct]);
  }
  const customerRows: Partial<Record<CustomerField, Cell>>[] = [];
  for (const cu of data.customers) {
    const customerCells = {
      customerId: cu.stId,
      customerName: cu.name,
      customerType: labelOf(CUSTOMER_TYPE_NAMES, cu.type),
      customerEmail: cu.email,
      billingStreet: cu.billStreet,
      billingStreet2: cu.billStreet2,
      billingCity: cu.billCity,
      billingState: cu.billState,
      billingZip: cu.billZip,
      paymentTerms: cu.termsNetDays ? `Net ${cu.termsNetDays}` : "Due Upon Receipt",
      poRequired: cu.poRequired ?? false,
      taxExempt: cu.taxExempt ?? false,
    };
    const contactCells = (ct: DemoData["contacts"][number]) => ({
      contactId: ct.stId,
      contactName: ct.name,
      contactPhone: usPhone(ct.phone),
      contactAltPhone: usPhone(ct.altPhone),
      contactEmail: ct.email,
      textOptIn: ct.textOptIn ?? false,
      primaryContact: ct.isPrimary ?? false,
    });
    for (const l of locationsOf.get(cu.id) ?? []) {
      const locationCells = {
        locationId: l.stId,
        locationName: l.name,
        locationStreet: l.street,
        locationStreet2: l.street2,
        locationCity: l.city,
        locationState: l.state,
        locationZip: l.zip,
        latitude: l.lat,
        longitude: l.lng,
        accessNotes: l.accessNotes,
        defaultBusinessUnit: buLabel(l.defaultBusinessUnitId),
      };
      const siteContacts = contactsOf.get(l.id) ?? [];
      const [firstContact, ...more] = siteContacts;
      customerRows.push({
        ...customerCells,
        ...locationCells,
        ...(firstContact ? contactCells(firstContact) : {}),
      });
      for (const ct of more)
        customerRows.push({ ...customerCells, ...locationCells, ...contactCells(ct) });
    }
    for (const ct of contactsOf.get(`customer:${cu.id}`) ?? []) {
      customerRows.push({ ...customerCells, ...contactCells(ct) });
    }
    if (!locationsOf.has(cu.id) && !contactsOf.has(`customer:${cu.id}`)) {
      customerRows.push(customerCells);
    }
  }
  files.customers = sheet(
    MAPPINGS.customers as ReportMapping<CustomerField>,
    [
      "customerId",
      "customerName",
      "customerType",
      "customerEmail",
      "billingStreet",
      "billingStreet2",
      "billingCity",
      "billingState",
      "billingZip",
      "paymentTerms",
      "poRequired",
      "taxExempt",
      "locationId",
      "locationName",
      "locationStreet",
      "locationStreet2",
      "locationCity",
      "locationState",
      "locationZip",
      "latitude",
      "longitude",
      "accessNotes",
      "defaultBusinessUnit",
      "contactId",
      "contactName",
      "contactPhone",
      "contactAltPhone",
      "contactEmail",
      "textOptIn",
      "primaryContact",
    ],
    customerRows,
  );

  // --- equipment -------------------------------------------------------------
  const eq = MAPPINGS.equipment.fields;
  files.equipment = sheet(
    MAPPINGS.equipment as ReportMapping<keyof typeof eq>,
    [
      "equipmentId",
      "locationId",
      "customerId",
      "equipmentType",
      "brand",
      "model",
      "serial",
      "installYear",
      "warrantyEnd",
      "status",
      "removedOn",
    ],
    data.equipment.map((e) => {
      const l = need(locations, e.locationId, "location");
      return {
        equipmentId: e.stId,
        locationId: l.stId,
        customerId: need(customers, l.customerId, "customer").stId,
        equipmentType: labelOf(EQUIPMENT_KIND_NAMES, e.kind),
        brand: e.brand,
        model: e.model,
        serial: e.serial,
        installYear: e.installYear,
        warrantyEnd: usDate(e.warrantyEnd),
        status: e.deletedAt ? "Inactive" : "Active",
        removedOn: usDateTime(e.deletedAt),
      };
    }),
  );

  // --- memberships -----------------------------------------------------------
  const m = MAPPINGS.memberships.fields;
  files.memberships = sheet(
    MAPPINGS.memberships as ReportMapping<keyof typeof m>,
    [
      "membershipId",
      "customerId",
      "locationId",
      "planId",
      "planName",
      "status",
      "startDate",
      "endDate",
      "visitsRemaining",
      "price",
      "autoRenew",
      "soldBy",
      "canceledOn",
    ],
    data.memberships.map((ms) => {
      const l = need(locations, ms.locationId, "location");
      const plan = need(plans, ms.planId, "membership plan");
      return {
        membershipId: ms.stId,
        customerId: need(customers, l.customerId, "customer").stId,
        locationId: l.stId,
        planId: plan.stId,
        planName: plan.name,
        status: labelOf(MEMBERSHIP_STATUS_NAMES, ms.status),
        startDate: usDate(ms.startDate),
        endDate: usDate(ms.endDate),
        visitsRemaining: ms.visitsRemaining,
        price: money(ms.priceCents),
        autoRenew: ms.autoRenew ?? false,
        soldBy: techId(ms.soldByUserId),
        canceledOn: usDateTime(ms.canceledAt),
      };
    }),
  );

  // --- jobs and invoices with line items -------------------------------------
  const iv = MAPPINGS.invoices.fields;
  type InvoiceField = keyof typeof iv;
  const invoicesOf = new Map<string, DemoData["invoices"]>();
  for (const inv of data.invoices) {
    const key = inv.jobId ?? `none:${inv.id}`;
    invoicesOf.set(key, [...(invoicesOf.get(key) ?? []), inv]);
  }
  const linesOf = new Map<string, DemoData["invoiceLines"]>();
  for (const line of data.invoiceLines) {
    linesOf.set(line.invoiceId, [...(linesOf.get(line.invoiceId) ?? []), line]);
  }
  const invoiceRows: Partial<Record<InvoiceField, Cell>>[] = [];
  const jobCells = (job: DemoData["jobs"][number]) => ({
    jobNumber: job.number,
    jobType: titleCase(job.jobType),
    jobSummary: job.summary,
    jobStatus: labelOf(JOB_STATUS_NAMES, job.status ?? "scheduled"),
    priority: labelOf(JOB_PRIORITY_NAMES, job.priority ?? "scheduled"),
    jobSource: job.source,
    bookedBy: techId(job.bookedByUserId),
    bookedOn: usDateTime(job.bookedAt),
    completedOn: usDateTime(job.finishedAt),
    soldBy: techId(job.soldByUserId),
    leadBy: techId(job.leadSourceUserId),
    recallFor: job.callbackOfJobId ? need(jobs, job.callbackOfJobId, "job").number : "",
    recallTechCaused: job.callbackTechCaused,
    recallReason: job.callbackReason,
    customerId: need(customers, job.customerId, "customer").stId,
    customerName: need(customers, job.customerId, "customer").name,
    locationId: need(locations, job.locationId, "location").stId,
    businessUnit: buLabel(job.businessUnitId),
    poNumber: job.poNumber,
  });
  const invoiceCells = (inv: DemoData["invoices"][number]) => ({
    customerId: need(customers, inv.customerId, "customer").stId,
    customerName: need(customers, inv.customerId, "customer").name,
    locationId: inv.locationId ? need(locations, inv.locationId, "location").stId : "",
    businessUnit: buLabel(inv.businessUnitId),
    poNumber: inv.poNumber,
    invoiceNumber: inv.number,
    invoiceDate: usDate(inv.invoiceDate),
    dueDate: usDate(inv.dueDate),
    invoiceStatus: labelOf(INVOICE_STATUS_NAMES, inv.status ?? "open"),
    billingStage: inv.billingStage ? labelOf(BILLING_STAGE_NAMES, inv.billingStage) : "",
    invoiceSummary: inv.summary,
    subtotal: money(inv.subtotalCents ?? 0),
    discount: money(inv.discountCents ?? 0),
    tax: money(inv.taxCents ?? 0),
    total: money(inv.totalCents ?? 0),
    balance: money(inv.balanceCents ?? 0),
    paidOn: usDateTime(inv.paidInFullAt),
  });
  const lineCells = (line: DemoData["invoiceLines"][number]) => {
    const item = line.pricebookItemId ? items.get(line.pricebookItemId) : undefined;
    return {
      lineId: line.stId,
      lineNumber: line.sortOrder,
      itemCode: item?.code ?? "",
      itemType: item ? labelOf(PRICEBOOK_KIND_NAMES, item.kind) : "",
      description: line.description,
      quantity: quantityText(line.quantity),
      unitPrice: money(line.unitPriceCents),
      lineDiscount: money(line.discountCents ?? 0),
      lineAmount: money(line.amountCents),
      taxable: line.taxable ?? false,
      lineTax: money(line.taxCents ?? 0),
      cost: money(line.costCents ?? 0),
    };
  };
  const pushInvoice = (
    head: Partial<Record<InvoiceField, Cell>>,
    inv: DemoData["invoices"][number],
  ) => {
    const lines = [...(linesOf.get(inv.id) ?? [])].sort(
      (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
    );
    if (lines.length === 0) invoiceRows.push({ ...head, ...invoiceCells(inv) });
    for (const line of lines) {
      invoiceRows.push({ ...head, ...invoiceCells(inv), ...lineCells(line) });
    }
  };
  for (const job of data.jobs) {
    const head = jobCells(job);
    const jobInvoices = invoicesOf.get(job.id) ?? [];
    if (jobInvoices.length === 0) invoiceRows.push(head);
    for (const inv of jobInvoices) pushInvoice(head, inv);
  }
  for (const inv of data.invoices) if (!inv.jobId) pushInvoice({}, inv);
  files.invoices = sheet(
    MAPPINGS.invoices as ReportMapping<InvoiceField>,
    [
      "jobNumber",
      "jobType",
      "jobSummary",
      "jobStatus",
      "priority",
      "jobSource",
      "bookedBy",
      "bookedOn",
      "completedOn",
      "soldBy",
      "leadBy",
      "recallFor",
      "recallTechCaused",
      "recallReason",
      "customerId",
      "customerName",
      "locationId",
      "businessUnit",
      "poNumber",
      "invoiceNumber",
      "invoiceDate",
      "dueDate",
      "invoiceStatus",
      "billingStage",
      "invoiceSummary",
      "subtotal",
      "discount",
      "tax",
      "total",
      "balance",
      "paidOn",
      "lineId",
      "lineNumber",
      "itemCode",
      "itemType",
      "description",
      "quantity",
      "unitPrice",
      "lineDiscount",
      "lineAmount",
      "taxable",
      "lineTax",
      "cost",
    ],
    invoiceRows,
  );

  // --- payments --------------------------------------------------------------
  const pm = MAPPINGS.payments.fields;
  files.payments = sheet(
    MAPPINGS.payments as ReportMapping<keyof typeof pm>,
    [
      "paymentId",
      "invoiceNumber",
      "jobNumber",
      "customerId",
      "customerName",
      "businessUnit",
      "paymentType",
      "paidOn",
      "amount",
      "fee",
      "checkNumber",
      "reference",
      "memo",
    ],
    data.payments.map((pay) => {
      const inv = need(invoices, pay.invoiceId, "invoice");
      const cu = need(customers, inv.customerId, "customer");
      const signed = pay.kind === "payment" || !pay.kind ? pay.amountCents : -pay.amountCents;
      return {
        paymentId: pay.stId,
        invoiceNumber: inv.number,
        jobNumber: inv.jobId ? need(jobs, inv.jobId, "job").number : "",
        customerId: cu.stId,
        customerName: cu.name,
        businessUnit: buLabel(inv.businessUnitId),
        paymentType: labelOf(PAYMENT_METHOD_NAMES, pay.method),
        paidOn: usDateTime(pay.receivedAt),
        amount: money(signed),
        fee: money(pay.feeCents ?? 0),
        checkNumber: pay.checkNumber,
        reference: pay.reference,
        memo: pay.notes,
      };
    }),
  );

  // --- timesheets ------------------------------------------------------------
  const ts = MAPPINGS.timesheets.fields;
  files.timesheets = sheet(
    MAPPINGS.timesheets as ReportMapping<keyof typeof ts>,
    ["timesheetId", "technicianId", "technicianName", "activity", "jobNumber", "start", "end"],
    data.timeEntries.map((entry) => ({
      timesheetId: entry.stId,
      technicianId: techId(entry.userId),
      technicianName: need(users, entry.userId, "user").name,
      activity: labelOf(TIME_ENTRY_KIND_NAMES, entry.kind),
      jobNumber: entry.jobId ? need(jobs, entry.jobId, "job").number : "",
      start: usDateTime(entry.startedAt),
      end: usDateTime(entry.endedAt),
    })),
  );

  return { files, summary: buildSummary(data, { jobs, invoices, buLabel }) };
}

/**
 * What ServiceTitan's own summary reports would show for the demo data,
 * computed straight from the data (not from the CSVs), so an import is
 * checked against an independent number.
 */
function buildSummary(
  data: DemoData,
  maps: {
    jobs: Map<string, DemoData["jobs"][number]>;
    invoices: Map<string, DemoData["invoices"][number]>;
    buLabel: (id: string | null | undefined) => string;
  },
): DemoSummaryFile {
  const group = (
    entries: { businessUnit: string | null; year: number | null; cents: number | null }[],
  ): SummaryRow[] => {
    const totals = new Map<string, { count: number; cents: number | null; row: SummaryRow }>();
    for (const e of entries) {
      const key = JSON.stringify([e.businessUnit, e.year]);
      const current = totals.get(key) ?? {
        count: 0,
        cents: e.cents === null ? null : 0,
        row: { businessUnit: e.businessUnit, year: e.year },
      };
      current.count += 1;
      if (current.cents !== null && e.cents !== null) current.cents += e.cents;
      totals.set(key, current);
    }
    return [...totals.values()]
      .map(({ count, cents, row }) => ({
        ...row,
        count,
        ...(cents === null ? {} : { total: formatCents(cents) }),
      }))
      .sort(
        (a, b) =>
          String(a.businessUnit ?? "").localeCompare(String(b.businessUnit ?? "")) ||
          (a.year ?? 0) - (b.year ?? 0),
      );
  };
  const countOnly = (n: number): SummaryRow[] => [{ businessUnit: null, year: null, count: n }];
  const demo = summarizeDemoData(data);
  return {
    about:
      "ServiceTitan-style summary totals for the demo exports in this folder, computed directly from @dwrg/db generateDemoData (not from the CSV files). Business units are ServiceTitan names; null business unit or year means the report isn't split that way. Totals are dollars as ServiceTitan shows them. Regenerate with: pnpm --filter @dwrg/st-import demo-csvs",
    generatedFrom: DEMO_EXPORT_OPTIONS,
    demoTotals: {
      invoiceTotalCents: demo.totals.invoiceTotalCents,
      openBalanceCents: demo.totals.openBalanceCents,
      paymentsCents: demo.totals.paymentsCents,
      fingerprint: demo.fingerprint,
    },
    reports: {
      technicians: countOnly(data.employees.length),
      pricebook: countOnly(data.pricebookItems.length),
      customers: countOnly(data.customers.length),
      equipment: countOnly(data.equipment.length),
      memberships: group(
        data.memberships.map((ms) => ({
          businessUnit: null,
          year: yearOfLocalDate(ms.startDate),
          cents: ms.priceCents,
        })),
      ),
      invoices: group(
        data.invoices.map((inv) => ({
          businessUnit: maps.buLabel(inv.businessUnitId),
          year: yearOfLocalDate(inv.invoiceDate),
          cents: inv.totalCents ?? 0,
        })),
      ),
      payments: group(
        data.payments.map((pay) => ({
          businessUnit: maps.buLabel(maps.invoices.get(pay.invoiceId)?.businessUnitId),
          year: localYearOf(pay.receivedAt),
          cents: pay.kind === "payment" || !pay.kind ? pay.amountCents : -pay.amountCents,
        })),
      ),
      timesheets: group(
        data.timeEntries.map((entry) => {
          const job = entry.jobId ? maps.jobs.get(entry.jobId) : undefined;
          return {
            businessUnit: job ? maps.buLabel(job.businessUnitId) : null,
            year: localYearOf(entry.startedAt),
            cents: null,
          };
        }),
      ),
    },
  };
}
