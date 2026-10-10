import { type CustomerType, customerDetailSchema, customerListResponseSchema } from "@dwrg/shared";
import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { api } from "../../lib/api";

export interface CustomerSearch {
  q?: string;
  type?: CustomerType;
  page?: number;
}

export const CUSTOMER_PAGE_SIZE = 25;

/**
 * The list's search as last shown, so "← Customers" on a customer's file goes
 * back to the same results instead of an empty search (kept for this page
 * load only).
 */
let lastListSearch: CustomerSearch = {};

export function rememberCustomerListSearch(search: CustomerSearch): void {
  lastListSearch = search;
}

export function lastCustomerListSearch(): CustomerSearch {
  return lastListSearch;
}

export const customerListQuery = (search: CustomerSearch) =>
  queryOptions({
    queryKey: ["customers", "list", search],
    queryFn: ({ signal }) =>
      api("/api/customers", {
        query: {
          q: search.q,
          type: search.type,
          page: search.page ?? 1,
          pageSize: CUSTOMER_PAGE_SIZE,
        },
        schema: customerListResponseSchema,
        signal,
      }),
    placeholderData: keepPreviousData,
  });

export const customerDetailQuery = (id: string) =>
  queryOptions({
    queryKey: ["customers", "detail", id],
    queryFn: ({ signal }) => api(`/api/customers/${id}`, { schema: customerDetailSchema, signal }),
  });
