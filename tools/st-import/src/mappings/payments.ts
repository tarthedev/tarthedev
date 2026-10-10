import { defineMapping } from "./types";

/** ServiceTitan payments export: one row per payment or refund (a negative amount). */
export const paymentsMapping = defineMapping({
  type: "payments",
  label: "Payments",
  rowMeaning: "one payment or refund",
  fields: {
    paymentId: { headers: ["Payment ID", "Payment #", "Payment Number"], required: true },
    invoiceNumber: { headers: ["Invoice #", "Invoice Number", "Invoice ID"], required: true },
    jobNumber: { headers: ["Job #", "Job Number"], informational: true },
    customerId: { headers: ["Customer ID", "Customer #"], informational: true },
    customerName: { headers: ["Customer Name", "Customer"], informational: true },
    businessUnit: { headers: ["Business Unit"], informational: true },
    paymentType: { headers: ["Payment Type", "Payment Method", "Type"], required: true },
    paidOn: { headers: ["Paid On", "Payment Date", "Date"], required: true },
    amount: { headers: ["Amount", "Payment Amount", "Total"], required: true },
    fee: { headers: ["Fee", "Processing Fee", "Dealer Fee"] },
    checkNumber: { headers: ["Check #", "Check Number"] },
    reference: { headers: ["Reference", "Reference #", "Auth Code", "Transaction ID"] },
    memo: { headers: ["Memo", "Notes", "Payment Notes"] },
  },
});
