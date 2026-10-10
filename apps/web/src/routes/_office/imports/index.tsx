import {
  type ImportBatch,
  type ImportBatchDetail,
  type ImportPreviewResponse,
  MAX_IMPORT_FILE_BYTES,
  ST_REPORT_LABELS,
  ST_REPORT_TYPES,
  type StReportType,
} from "@dwrg/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  Loading,
  PageHeader,
  Pager,
  SelectField,
} from "../../../components/ui";
import {
  IMPORT_HISTORY_PAGE_SIZE,
  importDetailQuery,
  importListQuery,
  importsKey,
  previewImport,
  runImport,
} from "../../../features/imports/api";
import { ImportPreviewPanel } from "../../../features/imports/ImportPreviewPanel";
import { ImportReport } from "../../../features/imports/ImportReport";
import { messageOf } from "../../../lib/api";
import { formatBytes, formatInstant, groupThousands } from "../../../lib/format";
import { IMPORT_STATUS_LABELS } from "../../../lib/labels";
import { searchPage } from "../../../lib/search";
import { useTitle } from "../../../lib/useTitle";

/**
 * The office Import page (docs/06): upload a ServiceTitan report export,
 * see the detected type and a preview with row problems, confirm, then read
 * the import report. Past uploads are listed below.
 */
export const Route = createFileRoute("/_office/imports/")({
  validateSearch: (search: Record<string, unknown>): { page?: number } => ({
    page: searchPage(search.page),
  }),
  component: ImportsPage,
});

function ImportsPage() {
  useTitle("Import");
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [picked, setPicked] = useState<StReportType | "">("");
  const [fileProblem, setFileProblem] = useState<string | null>(null);

  const preview = useMutation<ImportPreviewResponse, Error, { file: File; type?: StReportType }>({
    mutationFn: ({ file, type }) => previewImport(file, type),
  });
  const importing = useMutation<ImportBatchDetail, Error, ImportPreviewResponse>({
    mutationFn: (shown) => {
      if (!file || !shown.reportType) throw new Error("Preview the file first.");
      return runImport(file, shown.reportType, shown.file.sha256);
    },
    onSuccess: (detail) => {
      queryClient.setQueryData(importDetailQuery(detail.id).queryKey, detail);
      void queryClient.invalidateQueries({ queryKey: [...importsKey, "list"] });
      // Imported rows change what the other screens show.
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
      void queryClient.invalidateQueries({ queryKey: ["pricebook"] });
      void queryClient.invalidateQueries({ queryKey: ["employees"] });
    },
  });

  function startOver() {
    preview.reset();
    importing.reset();
  }

  function chooseFile(next: File | null) {
    startOver();
    setFileProblem(null);
    if (next && next.size > MAX_IMPORT_FILE_BYTES) {
      setFileProblem(
        `That file is ${formatBytes(next.size)}. The limit is ${formatBytes(MAX_IMPORT_FILE_BYTES)}: export a shorter date range.`,
      );
      setFile(null);
      return;
    }
    setFile(next);
  }

  const shown = preview.data;
  const result = importing.data;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Import from ServiceTitan"
        subtitle="Upload a report export (CSV). Nothing is ever sent back to ServiceTitan."
      />

      <Card title="1. Choose the export">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!file) {
              setFileProblem("Choose a CSV file first.");
              return;
            }
            importing.reset();
            preview.mutate({ file, type: picked || undefined });
          }}
        >
          <div>
            <input
              ref={fileInput}
              id="import-file"
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(e) => chooseFile(e.target.files?.[0] ?? null)}
            />
            <label
              htmlFor="import-file"
              className="flex min-h-16 cursor-pointer flex-wrap items-center gap-3 rounded-xl border-2 border-dashed border-navy/40 bg-paper px-4 py-3 hover:border-blue has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-blue"
            >
              <span className="inline-flex min-h-12 items-center rounded-xl bg-navy px-4 text-lg font-semibold text-paper">
                {file ? "Choose a different file" : "Choose a CSV file"}
              </span>
              <span className="text-lg break-all">
                {file ? `${file.name} · ${formatBytes(file.size)}` : "No file chosen"}
              </span>
            </label>
            {fileProblem ? (
              <p className="mt-2 text-base font-semibold text-bad">{fileProblem}</p>
            ) : null}
          </div>
          <SelectField
            label="Report type"
            hint="Import in this order the first time: technicians, pricebook, customers, equipment, memberships, invoices, payments, timesheets."
            value={picked}
            onChange={(e) => {
              startOver();
              setPicked(e.target.value as StReportType | "");
            }}
          >
            <option value="">Detect from the columns</option>
            {ST_REPORT_TYPES.map((type) => (
              <option key={type} value={type}>
                {ST_REPORT_LABELS[type]}
              </option>
            ))}
          </SelectField>
          <Button type="submit" busy={preview.isPending} disabled={!file}>
            {preview.isPending ? "Reading the file…" : "Preview"}
          </Button>
          {preview.isError ? (
            <Alert tone="error" title="Couldn't preview the file">
              {messageOf(preview.error)}
            </Alert>
          ) : null}
        </form>
      </Card>

      {shown && !result ? (
        <ImportPreviewPanel
          preview={shown}
          pickedByHand={picked !== ""}
          importing={importing.isPending}
          onImport={() => importing.mutate(shown)}
        />
      ) : null}
      {importing.isError ? (
        <Alert tone="error" title="The import didn't run">
          {messageOf(importing.error)}
        </Alert>
      ) : null}

      {result ? (
        <Card
          title="4. Import report"
          actions={
            <ButtonLink to="/imports/$batchId" params={{ batchId: result.id }}>
              Compare with ServiceTitan's summary
            </ButtonLink>
          }
        >
          <ImportReport detail={result} />
          <div className="mt-5 border-t border-line pt-4">
            <Button
              variant="secondary"
              onClick={() => {
                startOver();
                setFile(null);
                setPicked("");
                if (fileInput.current) fileInput.current.value = "";
              }}
            >
              Import another file
            </Button>
          </div>
        </Card>
      ) : null}

      <ImportHistory />
    </div>
  );
}

function ImportHistory() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const page = search.page ?? 1;
  const list = useQuery(importListQuery(page));
  return (
    <Card title="Past imports">
      {list.isPending ? (
        <Loading label="Loading past imports…" />
      ) : list.isError ? (
        <Alert tone="error">{messageOf(list.error)}</Alert>
      ) : list.data.items.length === 0 ? (
        <EmptyState>No imports yet.</EmptyState>
      ) : (
        <>
          <ul className="divide-y divide-line">
            {list.data.items.map((batch) => (
              <li key={batch.id}>
                <HistoryRow batch={batch} />
              </li>
            ))}
          </ul>
          <Pager
            page={list.data.page}
            pageSize={IMPORT_HISTORY_PAGE_SIZE}
            total={list.data.total}
            noun={["import", "imports"]}
            onPage={(next) => void navigate({ search: { page: next > 1 ? next : undefined } })}
          />
        </>
      )}
    </Card>
  );
}

function HistoryRow({ batch }: { batch: ImportBatch }) {
  return (
    <Link
      to="/imports/$batchId"
      params={{ batchId: batch.id }}
      className="flex min-h-16 flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 hover:bg-paper"
    >
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-lg font-semibold text-navy">
          {batch.reportType ? ST_REPORT_LABELS[batch.reportType] : "Unknown report"}
          <Badge
            tone={
              batch.status === "imported" ? "ok" : batch.status === "failed" ? "bad" : "neutral"
            }
          >
            {IMPORT_STATUS_LABELS[batch.status]}
          </Badge>
        </p>
        <p className="text-base break-all text-muted">
          {batch.fileName} · {formatInstant(batch.uploadedAt)}
          {batch.uploadedBy ? ` · ${batch.uploadedBy.name}` : ""}
        </p>
      </div>
      <p className="tabular text-base text-muted">
        {groupThousands(batch.inserted)} new · {groupThousands(batch.updated)} updated ·{" "}
        {groupThousands(batch.unchanged)} unchanged · {groupThousands(batch.rejected)} rejected
      </p>
    </Link>
  );
}
