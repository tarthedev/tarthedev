import {
  type ImportSummaryRow,
  importBatchDetailSchema,
  importListResponseSchema,
  importPreviewResponseSchema,
  type StReportType,
} from "@dwrg/shared";
import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { api } from "../../lib/api";

/** Client calls for the Import page (POST/GET /api/imports...). */

function uploadForm(file: File, fields: Record<string, string | undefined>): FormData {
  const form = new FormData();
  form.set("file", file, file.name);
  for (const [key, value] of Object.entries(fields)) if (value) form.set(key, value);
  return form;
}

/** Detects, maps and checks the file. Writes nothing. */
export function previewImport(file: File, reportType: StReportType | undefined) {
  return api("/api/imports/preview", {
    method: "POST",
    body: uploadForm(file, { reportType }),
    schema: importPreviewResponseSchema,
  });
}

/**
 * Imports the file the preview showed: the same report type, and its
 * sha256, so the server refuses a file that changed in between.
 */
export function runImport(file: File, reportType: StReportType, sha256: string) {
  return api("/api/imports", {
    method: "POST",
    body: uploadForm(file, { reportType, sha256 }),
    schema: importBatchDetailSchema,
  });
}

export function enterSummary(batchId: string, rows: ImportSummaryRow[]) {
  return api(`/api/imports/${batchId}/summary`, {
    method: "POST",
    json: { rows },
    schema: importBatchDetailSchema,
  });
}

export const IMPORT_HISTORY_PAGE_SIZE = 10;

export const importsKey = ["imports"] as const;

export const importListQuery = (page: number) =>
  queryOptions({
    queryKey: [...importsKey, "list", page],
    queryFn: ({ signal }) =>
      api("/api/imports", {
        query: { page, pageSize: IMPORT_HISTORY_PAGE_SIZE },
        schema: importListResponseSchema,
        signal,
      }),
    placeholderData: keepPreviousData,
  });

export const importDetailQuery = (id: string) =>
  queryOptions({
    queryKey: [...importsKey, "detail", id],
    queryFn: ({ signal }) => api(`/api/imports/${id}`, { schema: importBatchDetailSchema, signal }),
  });
