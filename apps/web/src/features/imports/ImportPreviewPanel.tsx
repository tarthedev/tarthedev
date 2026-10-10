import { type ImportPreviewResponse, ST_REPORT_LABELS } from "@dwrg/shared";
import { Alert, Badge, Button, Card } from "../../components/ui";
import { formatBytes, groupThousands, plural } from "../../lib/format";
import { IssueList } from "./IssueList";

/**
 * What an import of this file would do: the report type (detected or picked),
 * how its columns map, the first rows, and every problem by row number.
 * Nothing has been written yet; the Import button is the confirmation.
 */
export function ImportPreviewPanel({
  preview,
  pickedByHand,
  importing,
  onImport,
}: {
  preview: ImportPreviewResponse;
  /** The report type was chosen in the menu rather than detected. */
  pickedByHand: boolean;
  importing: boolean;
  onImport: () => void;
}) {
  const accepted = preview.rowCount - preview.rejectedRows;
  const label = preview.reportType ? ST_REPORT_LABELS[preview.reportType] : null;
  const fields = Object.keys(preview.columns);

  return (
    <Card title="2. Check the preview">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-lg">
          <span className="font-semibold break-all">{preview.file.name}</span>
          <span className="text-muted">· {formatBytes(preview.file.sizeBytes)}</span>
        </div>

        {label ? (
          <p className="text-xl">
            Report: <strong className="text-navy">{label}</strong>{" "}
            <Badge tone="neutral">
              {pickedByHand ? "Picked by you" : "Detected from the columns"}
            </Badge>
          </p>
        ) : null}

        {preview.fileError ? (
          <Alert tone="error" title="This file can't be imported as it is">
            <p>{preview.fileError}</p>
            {preview.reportType === null ? <ClosestMatches preview={preview} /> : null}
          </Alert>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Count label="Rows in the file" value={preview.rowCount} />
            <Count label="Ready to import" value={accepted} />
            <Count
              label="Will be rejected"
              value={preview.rejectedRows}
              bad={preview.rejectedRows > 0}
            />
          </div>
        )}

        {preview.errorCount > 0 ? (
          <div>
            <h3 className="mb-2 text-xl font-bold text-navy">
              Problems ({groupThousands(preview.errorCount)})
            </h3>
            <p className="mb-2 text-base text-muted">
              Rows with a problem are left out; the rest import. Fix them in ServiceTitan and export
              again, or import now and re-import later: rows are matched on ServiceTitan IDs, so
              nothing doubles.
            </p>
            <IssueList issues={preview.errors} total={preview.errorCount} />
          </div>
        ) : null}

        {fields.length > 0 ? (
          <details className="rounded-xl border border-line px-4 py-2">
            <summary className="min-h-12 cursor-pointer py-2 text-lg font-semibold text-navy">
              Columns used ({fields.length})
              {preview.unmatchedHeaders.length > 0
                ? `, ignored (${preview.unmatchedHeaders.length})`
                : ""}
            </summary>
            <ul className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-base sm:grid-cols-2">
              {fields.map((field) => (
                <li key={field}>
                  <span className="font-semibold">{preview.columns[field]}</span>
                </li>
              ))}
            </ul>
            {preview.unmatchedHeaders.length > 0 ? (
              <p className="mt-3 text-base text-muted">
                Ignored (kept in the raw upload): {preview.unmatchedHeaders.join(", ")}
              </p>
            ) : null}
          </details>
        ) : null}

        {preview.rows.length > 0 ? (
          <div>
            <h3 className="mb-1 text-xl font-bold text-navy">
              First {plural(preview.rows.length, "row")}
            </h3>
            <p className="mb-2 text-base text-muted">Swipe sideways to see every column.</p>
            <div className="max-h-[28rem] overflow-auto rounded-xl border border-line">
              <table className="min-w-full border-collapse text-left text-base">
                <thead className="sticky top-0 bg-paper">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-semibold whitespace-nowrap">
                      Row
                    </th>
                    {fields.map((field) => (
                      <th
                        key={field}
                        scope="col"
                        className="px-3 py-2 font-semibold whitespace-nowrap"
                      >
                        {preview.columns[field]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <tr key={row.rowNumber} className="border-t border-line">
                      <td className="tabular px-3 py-2 text-muted">{row.rowNumber}</td>
                      {fields.map((field) => (
                        <td key={field} className="px-3 py-2 whitespace-nowrap">
                          {row.fields[field] ?? ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        <div className="border-t border-line pt-4">
          <h3 className="mb-2 text-xl font-bold text-navy">3. Import</h3>
          {preview.fileError ? (
            <p className="text-lg text-muted">
              Fix the problem above (or pick the report type), then preview again.
            </p>
          ) : (
            <>
              <p className="mb-3 text-base text-muted">
                Safe to repeat: rows are matched on ServiceTitan IDs and updated, never doubled.
                Nothing is sent to ServiceTitan. Big files can take a minute.
              </p>
              <Button onClick={onImport} busy={importing} disabled={accepted === 0}>
                {importing
                  ? "Importing…"
                  : accepted === 0
                    ? "No rows to import"
                    : `Import ${plural(accepted, "row")}`}
              </Button>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

function Count({ label, value, bad = false }: { label: string; value: number; bad?: boolean }) {
  return (
    <div className={`rounded-xl border-2 px-4 py-3 ${bad ? "border-bad" : "border-line"}`}>
      <p className="text-sm font-semibold tracking-wide text-muted uppercase">{label}</p>
      <p className="tabular text-2xl font-bold text-navy">{groupThousands(value)}</p>
    </div>
  );
}

function ClosestMatches({ preview }: { preview: ImportPreviewResponse }) {
  const close = preview.candidates.filter((c) => c.matchedHeaders > 0).slice(0, 3);
  if (close.length === 0) return null;
  return (
    <div className="mt-2">
      <p className="font-semibold">Closest report types:</p>
      <ul className="list-disc pl-6">
        {close.map((c) => (
          <li key={c.reportType}>
            {c.label}
            {c.missingRequired.length > 0 ? ` (missing ${c.missingRequired.join(", ")})` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}
