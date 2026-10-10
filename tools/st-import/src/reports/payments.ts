import {
  jobCosts,
  type PaymentKind,
  type PaymentMethod,
  payments,
  type UpsertResult,
} from "@dwrg/db";
import { type GroupScope, rowResult } from "../context";
import { paymentsMapping } from "../mappings/payments";
import { PAYMENT_METHOD_NAMES } from "../mappings/values";
import { jobCostExists } from "./invoices";
import { defineHandler } from "./types";

export interface PaymentRow {
  stId: string;
  invoiceStId: string;
  kind: PaymentKind;
  method: PaymentMethod;
  /** Always positive; `kind` says which way the money went. */
  amountCents: number;
  feeCents: number | undefined;
  receivedAt: Date;
  checkNumber: string | null | undefined;
  reference: string | null | undefined;
  notes: string | null | undefined;
}

/**
 * Payments against imported invoices. A negative amount is a refund. A
 * processing or dealer fee becomes a job cost (card_fee, or finance_fee for
 * GreenSky) so it reduces the job's gross profit. Card data never appears in
 * these exports and nothing here stores any. Invoice balances stay as
 * ServiceTitan exported them in the invoices report.
 */
export const paymentsHandler = defineHandler({
  mapping: paymentsMapping,

  parse(r): PaymentRow {
    const amount = r.requiredMoney("amount");
    if (r.ok && amount === 0) r.fail("amount", `${r.label("amount")} is zero.`);
    const fee = r.money("fee");
    if (typeof fee === "number" && fee < 0) r.fail("fee", `${r.label("fee")} is negative.`);
    return {
      stId: r.requiredId("paymentId"),
      invoiceStId: r.requiredId("invoiceNumber"),
      kind: amount < 0 ? "refund" : "payment",
      method: r.requiredChoice("paymentType", PAYMENT_METHOD_NAMES, "check"),
      amountCents: Math.abs(amount),
      feeCents: fee === null ? 0 : fee,
      receivedAt: r.requiredInstant("paidOn"),
      checkNumber: r.text("checkNumber"),
      reference: r.text("reference"),
      notes: r.text("memo"),
    };
  },

  stIdOf: (row) => row.stId,

  claims: (row) => [
    { key: `payments:${row.stId}`, label: `Payment ${row.stId}`, details: { ...row } },
  ],

  businessUnits: () => [],

  async load(lookups, rows) {
    await lookups.loadInvoices(rows.map((row) => row.invoiceStId));
    await lookups.loadPayments(rows.map((row) => row.stId));
  },

  check(lookups, row, column) {
    lookups.notOwnedHere("payments", row.stId, column("paymentId"));
    lookups.invoice(row.invoiceStId, column("invoiceNumber"));
  },

  async importGroup(scope, rows, column) {
    const [parsed] = rows;
    if (!parsed) return [];
    const row = parsed.value;
    scope.lookups.notOwnedHere("payments", row.stId, column("paymentId"));
    const invoice = scope.lookups.invoice(row.invoiceStId, column("invoiceNumber"));
    const { invoiceStId: _invoice, ...fields } = row;
    const payment = await scope.upsert(payments, payments.stId, row.stId, {
      ...fields,
      origin: "servicetitan",
      invoiceId: invoice.id,
    });
    const fee = invoice.jobId
      ? await upsertFeeCost(scope, {
          stId: feeCostStId(row.stId),
          paymentId: payment.id,
          paymentIsNew: payment.result === "inserted",
          jobId: invoice.jobId,
          method: row.method,
          feeCents: row.feeCents,
          receivedAt: row.receivedAt,
        })
      : null;
    return [
      {
        rowNumber: parsed.rowNumber,
        result: rowResult(payment.result, [fee]),
        stId: row.stId,
        targetTable: "payments",
        targetId: payment.id,
        error: null,
      },
    ];
  },
});

/** ServiceTitan key of the job cost made from a payment's fee. */
export function feeCostStId(paymentStId: string): string {
  return `${paymentStId}/fee`;
}

/** The fee as a job cost, keyed on the payment's ServiceTitan ID (zero: see upsertLineCost). */
async function upsertFeeCost(
  scope: GroupScope,
  fee: {
    stId: string;
    paymentId: string;
    paymentIsNew: boolean;
    jobId: string;
    method: PaymentMethod;
    feeCents: number | undefined;
    receivedAt: Date;
  },
): Promise<UpsertResult | null> {
  if (fee.feeCents === undefined) return null;
  if (fee.feeCents === 0 && (fee.paymentIsNew || !(await jobCostExists(scope, fee.stId)))) {
    return null;
  }
  const greensky = fee.method === "greensky";
  const { result } = await scope.upsert(jobCosts, jobCosts.stId, fee.stId, {
    stId: fee.stId,
    jobId: fee.jobId,
    kind: greensky ? "finance_fee" : "card_fee",
    amountCents: fee.feeCents,
    source: "payment",
    sourceId: fee.paymentId,
    description: greensky ? "GreenSky dealer fee" : "Processing fee",
    incurredAt: fee.receivedAt,
    deletedAt: null,
  });
  return result;
}
