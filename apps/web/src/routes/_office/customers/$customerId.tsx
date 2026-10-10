import type {
  CustomerContact,
  CustomerDetail,
  CustomerLocation,
  InvoiceSummary,
  MembershipSummary,
} from "@dwrg/shared";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ScreenError } from "../../../components/errors";
import { Alert, Badge, Card, EmptyState, PageHeader, Stat } from "../../../components/ui";
import { EquipmentTable } from "../../../features/customers/EquipmentTable";
import { customerDetailQuery, lastCustomerListSearch } from "../../../features/customers/queries";
import { ApiError } from "../../../lib/api";
import { formatCents, formatDate, formatPhone, plural } from "../../../lib/format";
import {
  BILLING_STAGE_LABELS,
  BUSINESS_UNIT_LABELS,
  CUSTOMER_TYPE_LABELS,
  INVOICE_STATUS_LABELS,
  MEMBERSHIP_STATUS_LABELS,
  ORIGIN_LABELS,
  termsLabel,
} from "../../../lib/labels";
import { useTitle } from "../../../lib/useTitle";

/** The customer's file, as the screen pop shows it (docs/01, section 1). */
export const Route = createFileRoute("/_office/customers/$customerId")({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(customerDetailQuery(params.customerId)),
  component: CustomerPage,
  errorComponent: (props) =>
    props.error instanceof ApiError && props.error.status === 404 ? (
      <CustomerMissing />
    ) : (
      <ScreenError {...props} />
    ),
});

function BackToCustomers() {
  return (
    <Link
      to="/customers"
      search={lastCustomerListSearch()}
      className="inline-flex min-h-12 items-center text-lg font-semibold text-blue"
    >
      ← Customers
    </Link>
  );
}

function CustomerMissing() {
  return (
    <div>
      <BackToCustomers />
      <EmptyState>No customer with that id. It may have been removed.</EmptyState>
    </div>
  );
}

function CustomerPage() {
  const { customerId } = Route.useParams();
  const { data: customer } = useSuspenseQuery(customerDetailQuery(customerId));
  useTitle(customer.name);

  const flagged = customer.locations.filter((l) => l.replacementFlag);
  const activeMembership = customer.locations
    .flatMap((l) => l.memberships)
    .find((m) => m.status === "active");
  const primary = customer.contacts.find((c) => c.isPrimary) ?? customer.contacts[0];

  return (
    <div className="space-y-5">
      <PageHeader
        back={<BackToCustomers />}
        title={customer.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={customer.type === "commercial" ? "navy" : "neutral"}>
              {CUSTOMER_TYPE_LABELS[customer.type]}
            </Badge>
            {activeMembership ? (
              <Badge tone="blue">Member until {formatDate(activeMembership.endDate)}</Badge>
            ) : (
              <Badge tone="neutral">Not a member</Badge>
            )}
            {customer.stId ? (
              <span className="text-base">ServiceTitan #{customer.stId}</span>
            ) : null}
          </span>
        }
      />

      {flagged.length > 0 ? (
        <Alert tone="warning" title="Replacement flag">
          Equipment older than {customer.replacementAgeYears} years at{" "}
          {flagged.length === 1 ? "this location" : plural(flagged.length, "location")}:{" "}
          {flagged.map((l) => l.street).join("; ")}. Mention replacement options on this call.
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat
          label="Open balance"
          value={formatCents(customer.openBalanceCents)}
          tone={customer.openBalanceCents > 0 ? "bad" : "neutral"}
        />
        <Stat label="Phone" value={formatPhone(primary?.phone) || "None on file"} />
        <Stat label="Terms" value={termsLabel(customer.termsNetDays)} />
      </div>

      <AccountDetails customer={customer} />

      <section aria-labelledby="locations-heading" className="space-y-4">
        <h2 id="locations-heading" className="text-2xl font-bold text-navy">
          {customer.locations.length === 1
            ? "Service location"
            : `Service locations (${customer.locations.length})`}
        </h2>
        {customer.locations.length === 0 ? (
          <EmptyState>No service locations on file.</EmptyState>
        ) : (
          customer.locations.map((location) => (
            <LocationCard
              key={location.id}
              location={location}
              replacementAgeYears={customer.replacementAgeYears}
            />
          ))
        )}
      </section>

      <Card title="Contacts">
        <ContactList contacts={customer.contacts} />
      </Card>

      <Card title="Recent invoices">
        <InvoiceList invoices={customer.recentInvoices} />
      </Card>
    </div>
  );
}

function AccountDetails({ customer }: { customer: CustomerDetail }) {
  const billTo = customer.billTo;
  const rows: [string, string][] = [
    ["Email", customer.email ?? "None on file"],
    [
      "Bill to",
      billTo
        ? [
            billTo.street,
            billTo.street2,
            [billTo.city, billTo.state].filter(Boolean).join(", "),
            billTo.zip,
          ]
            .filter(Boolean)
            .join(", ")
        : "Same as service address",
    ],
    ["PO number", customer.poRequired ? "Required on every invoice" : "Not required"],
    ["Sales tax", customer.taxExempt ? "Tax exempt" : "Taxable"],
  ];
  return (
    <Card title="Account">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-sm font-semibold tracking-wide text-muted uppercase">{label}</dt>
            <dd className="text-lg break-words">{value}</dd>
          </div>
        ))}
      </dl>
      {customer.notes ? (
        <div className="mt-4 rounded-xl bg-paper px-4 py-3">
          <p className="text-sm font-semibold tracking-wide text-muted uppercase">Notes</p>
          <p className="text-lg whitespace-pre-line">{customer.notes}</p>
        </div>
      ) : null}
    </Card>
  );
}

function LocationCard({
  location,
  replacementAgeYears,
}: {
  location: CustomerLocation;
  replacementAgeYears: number;
}) {
  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          {location.name ? `${location.name}: ` : ""}
          {location.street}
          {location.replacementFlag ? <Badge tone="orange">Replacement flag</Badge> : null}
        </span>
      }
    >
      <p className="text-lg">
        {[location.street2, `${location.city}, ${location.state} ${location.zip}`]
          .filter(Boolean)
          .join(", ")}
      </p>
      <p className="mt-1 text-base text-muted">
        {location.defaultBusinessUnit
          ? `Usually ${BUSINESS_UNIT_LABELS[location.defaultBusinessUnit.code]}`
          : "No default department"}
        {location.stId ? ` · ServiceTitan location #${location.stId}` : ""}
      </p>
      {location.accessNotes ? (
        <p className="mt-2 rounded-xl bg-paper px-3 py-2 text-lg">
          <span className="font-semibold">Access: </span>
          {location.accessNotes}
        </p>
      ) : null}

      <h3 className="mt-5 mb-2 text-xl font-bold text-navy">Equipment</h3>
      <EquipmentTable equipment={location.equipment} replacementAgeYears={replacementAgeYears} />

      <h3 className="mt-5 mb-2 text-xl font-bold text-navy">Memberships</h3>
      <MembershipList memberships={location.memberships} />
    </Card>
  );
}

function MembershipList({ memberships }: { memberships: readonly MembershipSummary[] }) {
  if (memberships.length === 0) {
    return <p className="text-base text-muted">No membership at this location.</p>;
  }
  return (
    <ul className="space-y-2">
      {memberships.map((m) => (
        <li key={m.id} className="rounded-xl border border-line px-4 py-3">
          <p className="flex flex-wrap items-center gap-2 text-lg font-semibold">
            {m.planName}
            <Badge tone={m.status === "active" ? "ok" : "neutral"}>
              {MEMBERSHIP_STATUS_LABELS[m.status]}
            </Badge>
          </p>
          <p className="text-base text-muted">
            {formatDate(m.startDate)} to {formatDate(m.endDate)} ·{" "}
            {plural(m.visitsRemaining, "visit")} left · {formatCents(m.priceCents)} a year ·{" "}
            {m.autoRenew ? "Renews automatically" : "Renews by hand"}
          </p>
        </li>
      ))}
    </ul>
  );
}

function ContactList({ contacts }: { contacts: readonly CustomerContact[] }) {
  if (contacts.length === 0) return <p className="text-base text-muted">No contacts on file.</p>;
  return (
    <ul className="divide-y divide-line">
      {contacts.map((c) => (
        <li key={c.id} className="flex flex-wrap items-baseline justify-between gap-2 py-3">
          <div>
            <p className="flex flex-wrap items-center gap-2 text-lg font-semibold">
              {c.name}
              {c.isPrimary ? <Badge>Primary</Badge> : null}
            </p>
            <p className="text-base text-muted">
              {[c.email, c.textOptIn ? "OK to text" : "No texts"].filter(Boolean).join(" · ")}
            </p>
          </div>
          <p className="tabular text-right text-lg">
            {formatPhone(c.phone) || "No phone"}
            {c.altPhone ? (
              <span className="block text-base text-muted">Alt {formatPhone(c.altPhone)}</span>
            ) : null}
          </p>
        </li>
      ))}
    </ul>
  );
}

function InvoiceList({ invoices }: { invoices: readonly InvoiceSummary[] }) {
  if (invoices.length === 0) return <p className="text-base text-muted">No invoices yet.</p>;
  return (
    <table className="w-full border-collapse text-left">
      <caption className="sr-only">The 10 most recent invoices</caption>
      <thead>
        <tr className="border-b-2 border-line text-sm tracking-wide text-muted uppercase">
          <th scope="col" className="py-2 pr-3 font-semibold">
            Invoice
          </th>
          <th scope="col" className="py-2 pr-3 font-semibold">
            Status
          </th>
          <th scope="col" className="py-2 pr-3 text-right font-semibold">
            Total
          </th>
          <th scope="col" className="py-2 text-right font-semibold">
            Balance
          </th>
        </tr>
      </thead>
      <tbody>
        {invoices.map((invoice) => (
          <tr key={invoice.id} className="border-b border-line align-top last:border-b-0">
            <td className="py-3 pr-3">
              <p className="text-lg font-semibold">#{invoice.number}</p>
              <p className="text-base text-muted">
                {formatDate(invoice.invoiceDate)} · {ORIGIN_LABELS[invoice.origin]}
                {invoice.billingStage ? ` · ${BILLING_STAGE_LABELS[invoice.billingStage]}` : ""}
              </p>
              {invoice.summary ? <p className="text-base">{invoice.summary}</p> : null}
            </td>
            <td className="py-3 pr-3">
              <Badge
                tone={
                  invoice.status === "paid" ? "ok" : invoice.status === "open" ? "bad" : "neutral"
                }
              >
                {INVOICE_STATUS_LABELS[invoice.status]}
              </Badge>
            </td>
            <td className="tabular py-3 pr-3 text-right text-lg">
              {formatCents(invoice.totalCents)}
            </td>
            <td className="tabular py-3 text-right text-lg font-semibold">
              {formatCents(invoice.balanceCents)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
