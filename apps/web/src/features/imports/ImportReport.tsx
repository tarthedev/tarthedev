import { type ImportBatchDetail, type ImportTotal, ST_REPORT_LABELS } from "@dwrg/shared";
import { Alert, Badge, Stat } from "../../components/ui";
import { formatCents, formatInstant, formatSigned, groupThousands } from "../../lib/format";
import { businessUnitLabel, IMPORT_STATUS_LABELS } from "../../lib/labels";
import { IssueList } from "./IssueList";

/**
 * The import report (docs/06, "Prove it"): what happened to each row, and our
 * counts and dollar totals per department and year next to ServiceTitan's own
 * summary once it's entered.
 */
export function ImportReport({ detail }: { detail: ImportBatchDetail }) {
  const label = detail.reportType ? ST_REPORT_LABELS[detail.reportType] : "Unknown report";
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <p className="flex flex-wrap items-center gap-2 text-xl font-semibold text-navy">
          {label}
          <Badge
            tone={
              detail.status === "imported" ? "ok" : detail.status === "failed" ? "bad" : "neutral"
            }
          >
            {IMPORT_STATUS_LABELS[detail.status]}
          </Badge>
        </p>
        <p className="text-base break-all text-muted">
          {detail.fileName} · uploaded {formatInstant(detail.uploadedAt)}
          {detail.uploadedBy ? ` by ${detail.uploadedBy.name}` : ""}
        </p>
      </div>

      {detail.status === "failed" ? (
        <Alert tone="error" title="Nothing was imported">
          {detail.error ?? "The import stopped."} The upload is kept, so you can see what was sent.
        </Alert>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Rows read" value={groupThousands(detail.rowsRead)} />
        <Stat label="New" value={groupThousands(detail.inserted)} />
        <Stat label="Updated" value={groupThousands(detail.updated)} />
        <Stat label="Unchanged" value={groupThousands(detail.unchanged)} />
        <Stat
          label="Rejected"
          value={groupThousands(detail.rejected)}
          tone={detail.rejected > 0 ? "bad" : "neutral"}
        />
      </div>

      {detail.totals.length > 0 ? (
        <div>
          <h3 className="mb-1 text-xl font-bold text-navy">Totals</h3>
          {detail.totalsMeaning ? (
            <p className="mb-2 text-base text-muted">
              Count: {detail.totalsMeaning.count}.
              {detail.totalsMeaning.dollars ? ` Dollars: ${detail.totalsMeaning.dollars}.` : ""}
            </p>
          ) : null}
          {detail.summary.entered ? (
            <div className="mb-3">
              {detail.summary.matches ? (
                <Alert tone="success" title="Matches ServiceTitan's summary">
                  Every line agrees to the cent.
                </Alert>
              ) : (
                <Alert tone="warning" title="Doesn't match ServiceTitan's summary yet">
                  Explain or fix each line marked "Differs" (docs/06, "Prove it").
                </Alert>
              )}
            </div>
          ) : null}
          <TotalsTable totals={detail.totals} />
        </div>
      ) : null}

      {detail.errorCount > 0 ? (
        <div>
          <h3 className="mb-2 text-xl font-bold text-navy">
            Rejected rows ({groupThousands(detail.errorCount)})
          </h3>
          <IssueList issues={detail.errors} total={detail.errorCount} />
        </div>
      ) : null}
    </div>
  );
}

function amount(total: ImportTotal, value: number): string {
  return total.metric === "dollars" ? formatCents(value) : groupThousands(value);
}

export function yearLabel(year: number): string {
  return year === 0 ? "All years" : String(year);
}

function StatusCell({ total }: { total: ImportTotal }) {
  if (total.status === "match") return <Badge tone="ok">Matches</Badge>;
  if (total.status === "differs") return <Badge tone="bad">Differs</Badge>;
  return <span className="text-muted">{total.note ?? "No summary entered"}</span>;
}

export function TotalsTable({ totals }: { totals: readonly ImportTotal[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-white">
      <table className="w-full border-collapse text-left text-base">
        <caption className="sr-only">Our totals next to ServiceTitan's summary</caption>
        <thead className="bg-paper">
          <tr>
            <th scope="col" className="px-3 py-2 font-semibold">
              Department
            </th>
            <th scope="col" className="px-3 py-2 font-semibold">
              Year
            </th>
            <th scope="col" className="px-3 py-2 font-semibold">
              Measure
            </th>
            <th scope="col" className="px-3 py-2 text-right font-semibold">
              Ours
            </th>
            <th scope="col" className="px-3 py-2 text-right font-semibold">
              ServiceTitan
            </th>
            <th scope="col" className="px-3 py-2 text-right font-semibold">
              Difference
            </th>
            <th scope="col" className="px-3 py-2 font-semibold">
              Check
            </th>
          </tr>
        </thead>
        <tbody>
          {totals.map((t) => (
            <tr
              key={`${t.businessUnitCode}-${t.year}-${t.metric}`}
              className="border-t border-line"
            >
              <td className="px-3 py-2">{businessUnitLabel(t.businessUnitCode)}</td>
              <td className="tabular px-3 py-2">{yearLabel(t.year)}</td>
              <td className="px-3 py-2">{t.metric === "dollars" ? "Dollars" : "Count"}</td>
              <td className="tabular px-3 py-2 text-right font-semibold">{amount(t, t.ours)}</td>
              <td className="tabular px-3 py-2 text-right">
                {t.servicetitanSummary === null ? "—" : amount(t, t.servicetitanSummary)}
              </td>
              <td className="tabular px-3 py-2 text-right">
                {t.diff === null ? "—" : formatSigned(t.diff, (n) => amount(t, n))}
              </td>
              <td className="px-3 py-2">
                <StatusCell total={t} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
