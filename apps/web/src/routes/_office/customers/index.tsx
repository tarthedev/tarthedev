import { CUSTOMER_TYPES, type CustomerSummary, type CustomerType } from "@dwrg/shared";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import {
  Alert,
  Badge,
  EmptyState,
  Loading,
  PageHeader,
  Pager,
  Segmented,
} from "../../../components/ui";
import {
  CUSTOMER_PAGE_SIZE,
  type CustomerSearch,
  customerListQuery,
  rememberCustomerListSearch,
} from "../../../features/customers/queries";
import { messageOf } from "../../../lib/api";
import { formatPhone, plural } from "../../../lib/format";
import { searchOneOf, searchPage, searchText } from "../../../lib/search";
import { useSearchBox } from "../../../lib/useSearchBox";
import { useTitle } from "../../../lib/useTitle";

/**
 * Customers: the CSR's lookup while ServiceTitan's phones are still in use
 * (docs/06, "Phones stay on Phones Pro"). Search by name, phone in any
 * format, address, email or site name.
 */
export const Route = createFileRoute("/_office/customers/")({
  validateSearch: (search: Record<string, unknown>): CustomerSearch => ({
    q: searchText(search.q),
    type: searchOneOf(search.type, CUSTOMER_TYPES),
    page: searchPage(search.page),
  }),
  component: CustomersPage,
});

type TypeFilter = CustomerType | "all";

function CustomersPage() {
  useTitle("Customers");
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const box = useSearchBox(search.q, (q) =>
    navigate({ search: (prev) => ({ ...prev, q, page: undefined }), replace: true }),
  );

  const list = useQuery(customerListQuery(search));
  useEffect(() => rememberCustomerListSearch(search), [search]);

  return (
    <div>
      <PageHeader title="Customers" subtitle="Find a caller by name, phone, address or email." />
      <search>
        <form
          className="mb-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            box.submitNow();
          }}
        >
          <label htmlFor="customer-search" className="sr-only">
            Search customers
          </label>
          <input
            id="customer-search"
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Name, phone, address or email"
            value={box.text}
            onChange={(e) => box.setText(e.target.value)}
            className="block min-h-14 w-full rounded-2xl border-2 border-line bg-white px-4 text-xl focus:border-blue"
          />
          <Segmented<TypeFilter>
            label="Customer type"
            value={search.type ?? "all"}
            options={[
              { value: "all", label: "All" },
              { value: "residential", label: "Residential" },
              { value: "commercial", label: "Commercial" },
            ]}
            onChange={(type) =>
              void navigate({
                search: (prev) => ({
                  ...prev,
                  type: type === "all" ? undefined : type,
                  page: undefined,
                }),
              })
            }
          />
        </form>
      </search>

      {list.isPending ? (
        <Loading label="Finding customers…" />
      ) : list.isError ? (
        <Alert tone="error" title="Couldn't load customers">
          {messageOf(list.error)}
        </Alert>
      ) : list.data.items.length === 0 ? (
        <EmptyState>
          {search.q
            ? `No customers match "${search.q}".`
            : "No customers yet. Import them on the Import tab."}
        </EmptyState>
      ) : (
        <div aria-busy={list.isPlaceholderData || undefined}>
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white">
            {list.data.items.map((customer) => (
              <li key={customer.id}>
                <CustomerRow customer={customer} />
              </li>
            ))}
          </ul>
          <Pager
            page={list.data.page}
            pageSize={CUSTOMER_PAGE_SIZE}
            total={list.data.total}
            noun={["customer", "customers"]}
            onPage={(page) =>
              void navigate({ search: (prev) => ({ ...prev, page: page > 1 ? page : undefined }) })
            }
          />
        </div>
      )}
    </div>
  );
}

function CustomerRow({ customer }: { customer: CustomerSummary }) {
  const address = customer.address;
  return (
    <Link
      to="/customers/$customerId"
      params={{ customerId: customer.id }}
      className="flex min-h-16 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 hover:bg-paper"
    >
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-xl font-semibold text-navy">
          <span className="break-words">{customer.name}</span>
          {customer.member ? <Badge tone="blue">Member</Badge> : null}
          {customer.type === "commercial" ? <Badge tone="navy">Commercial</Badge> : null}
        </p>
        {address ? (
          <p className="text-base text-muted">
            {address.name ? `${address.name} · ` : ""}
            {address.street}, {address.city}, {address.state} {address.zip}
            {customer.locationCount > 1 ? ` · ${plural(customer.locationCount, "location")}` : ""}
          </p>
        ) : (
          <p className="text-base text-muted">No service address on file</p>
        )}
      </div>
      <p className="tabular text-lg font-semibold whitespace-nowrap text-ink">
        {formatPhone(customer.phone) || <span className="text-muted">No phone</span>}
      </p>
    </Link>
  );
}
