import {
  PRICEBOOK_KINDS,
  type PricebookItemResponse,
  type PricebookKind,
  pricebookListResponseSchema,
} from "@dwrg/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Alert,
  Badge,
  CheckChip,
  EmptyState,
  Loading,
  PageHeader,
  Pager,
  Segmented,
} from "../../components/ui";
import { api, messageOf } from "../../lib/api";
import { formatCents } from "../../lib/format";
import { PRICEBOOK_KIND_LABELS } from "../../lib/labels";
import { searchFlag, searchOneOf, searchPage, searchText } from "../../lib/search";
import { useSearchBox } from "../../lib/useSearchBox";
import { useTitle } from "../../lib/useTitle";

interface PricebookSearch {
  q?: string;
  kind?: PricebookKind;
  inactive?: boolean;
  page?: number;
}

const PAGE_SIZE = 50;

/** The pricebook, read-only (imported from ServiceTitan; docs/01, section 5). */
export const Route = createFileRoute("/_office/pricebook")({
  validateSearch: (search: Record<string, unknown>): PricebookSearch => ({
    q: searchText(search.q),
    kind: searchOneOf(search.kind, PRICEBOOK_KINDS),
    inactive: searchFlag(search.inactive),
    page: searchPage(search.page),
  }),
  component: PricebookPage,
});

type KindFilter = PricebookKind | "all";

function PricebookPage() {
  useTitle("Pricebook");
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const box = useSearchBox(search.q, (q) =>
    navigate({ search: (prev) => ({ ...prev, q, page: undefined }), replace: true }),
  );

  const list = useQuery({
    queryKey: ["pricebook", search],
    queryFn: ({ signal }) =>
      api("/api/pricebook", {
        query: {
          q: search.q,
          kind: search.kind,
          includeInactive: search.inactive ? true : undefined,
          page: search.page ?? 1,
          pageSize: PAGE_SIZE,
        },
        schema: pricebookListResponseSchema,
        signal,
      }),
    placeholderData: keepPreviousData,
  });

  return (
    <div>
      <PageHeader
        title="Pricebook"
        subtitle="Read-only. Prices come from ServiceTitan until the switch."
      />
      <div className="mb-4 space-y-3">
        <label htmlFor="pricebook-search" className="sr-only">
          Search the pricebook
        </label>
        <input
          id="pricebook-search"
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
          placeholder="Code, name or description"
          value={box.text}
          onChange={(e) => box.setText(e.target.value)}
          className="block min-h-14 w-full rounded-2xl border-2 border-line bg-white px-4 text-xl focus:border-blue"
        />
        <div className="flex flex-wrap items-center gap-3">
          <Segmented<KindFilter>
            label="Kind"
            value={search.kind ?? "all"}
            options={[
              { value: "all", label: "All" },
              ...PRICEBOOK_KINDS.map((kind) => ({
                value: kind,
                label: PRICEBOOK_KIND_LABELS[kind],
              })),
            ]}
            onChange={(kind) =>
              void navigate({
                search: (prev) => ({
                  ...prev,
                  kind: kind === "all" ? undefined : kind,
                  page: undefined,
                }),
              })
            }
          />
          <CheckChip
            label="Show inactive items"
            checked={search.inactive ?? false}
            onChange={(checked) =>
              void navigate({
                search: (prev) => ({ ...prev, inactive: checked || undefined, page: undefined }),
              })
            }
          />
        </div>
      </div>

      {list.isPending ? (
        <Loading label="Loading the pricebook…" />
      ) : list.isError ? (
        <Alert tone="error" title="Couldn't load the pricebook">
          {messageOf(list.error)}
        </Alert>
      ) : list.data.items.length === 0 ? (
        <EmptyState>
          {search.q
            ? `Nothing matches "${search.q}".`
            : "The pricebook is empty. Import it on the Import tab."}
        </EmptyState>
      ) : (
        <div aria-busy={list.isPlaceholderData || undefined}>
          <div className="overflow-hidden rounded-2xl border border-line bg-white">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">Pricebook items</caption>
              <thead>
                <tr className="border-b-2 border-line text-sm tracking-wide text-muted uppercase">
                  <th scope="col" className="px-4 py-2 font-semibold">
                    Item
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-semibold">
                    Price
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-semibold">
                    Member
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-semibold">
                    Cost
                  </th>
                  <th
                    scope="col"
                    className="hidden px-4 py-2 text-right font-semibold md:table-cell"
                  >
                    Time
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((item) => (
                  <PricebookRow key={item.id} item={item} />
                ))}
              </tbody>
            </table>
          </div>
          <Pager
            page={list.data.page}
            pageSize={PAGE_SIZE}
            total={list.data.total}
            noun={["item", "items"]}
            onPage={(page) =>
              void navigate({ search: (prev) => ({ ...prev, page: page > 1 ? page : undefined }) })
            }
          />
        </div>
      )}
    </div>
  );
}

function PricebookRow({ item }: { item: PricebookItemResponse }) {
  return (
    <tr className="border-b border-line align-top last:border-b-0">
      <td className="px-4 py-3">
        <p className="flex flex-wrap items-center gap-2 text-lg font-semibold">
          {item.name}
          {item.active ? null : <Badge tone="bad">Inactive</Badge>}
        </p>
        <p className="text-base text-muted">
          {item.code} · {PRICEBOOK_KIND_LABELS[item.kind]} · {item.category}
          {item.taxable ? " · Taxable" : ""}
        </p>
        {item.spiffCents > 0 ? (
          <p className="text-sm text-muted">Spiff {formatCents(item.spiffCents)}</p>
        ) : null}
      </td>
      <td className="tabular px-2 py-3 text-right text-lg font-semibold">
        {formatCents(item.priceCents)}
      </td>
      <td className="tabular px-2 py-3 text-right text-lg">
        {item.memberPriceCents === null ? "—" : formatCents(item.memberPriceCents)}
      </td>
      <td className="tabular px-2 py-3 text-right text-lg">{formatCents(item.costCents)}</td>
      <td className="tabular hidden px-4 py-3 text-right text-lg md:table-cell">
        {item.estMinutes === null ? "—" : `${item.estMinutes} min`}
      </td>
    </tr>
  );
}
