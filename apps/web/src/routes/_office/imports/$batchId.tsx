import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ScreenError } from "../../../components/errors";
import { Card, EmptyState, PageHeader } from "../../../components/ui";
import { enterSummary, importDetailQuery, importsKey } from "../../../features/imports/api";
import { ImportReport } from "../../../features/imports/ImportReport";
import { SummaryForm } from "../../../features/imports/SummaryForm";
import { ApiError } from "../../../lib/api";
import { useTitle } from "../../../lib/useTitle";

/** One upload's import report, and ServiceTitan's summary next to it (docs/06, "Prove it"). */
export const Route = createFileRoute("/_office/imports/$batchId")({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(importDetailQuery(params.batchId)),
  component: ImportReportPage,
  errorComponent: (props) =>
    props.error instanceof ApiError &&
    (props.error.status === 404 || props.error.status === 400) ? (
      <div>
        <BackToImports />
        <EmptyState>No import with that id.</EmptyState>
      </div>
    ) : (
      <ScreenError {...props} />
    ),
});

function BackToImports() {
  return (
    <Link
      to="/imports"
      className="inline-flex min-h-12 items-center text-lg font-semibold text-blue"
    >
      ← Import
    </Link>
  );
}

function ImportReportPage() {
  const { batchId } = Route.useParams();
  const queryClient = useQueryClient();
  const { data: detail } = useSuspenseQuery(importDetailQuery(batchId));
  useTitle("Import report");

  return (
    <div className="space-y-5">
      <PageHeader back={<BackToImports />} title="Import report" />
      <Card>
        <ImportReport detail={detail} />
      </Card>
      {detail.status === "imported" && detail.totals.length > 0 ? (
        <Card title="Compare with ServiceTitan's summary">
          <SummaryForm
            key={detail.id}
            detail={detail}
            onSubmit={async (rows) => {
              const updated = await enterSummary(detail.id, rows);
              queryClient.setQueryData(importDetailQuery(detail.id).queryKey, updated);
              void queryClient.invalidateQueries({ queryKey: [...importsKey, "list"] });
            }}
          />
        </Card>
      ) : null}
    </div>
  );
}
