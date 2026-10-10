import type { ImportIssue } from "@dwrg/shared";
import { groupThousands } from "../../lib/format";

/** Row problems as a table: spreadsheet row, column, what's wrong. */
export function IssueList({ issues, total }: { issues: readonly ImportIssue[]; total: number }) {
  return (
    <div>
      <div className="max-h-[24rem] overflow-auto rounded-xl border border-line">
        <table className="w-full border-collapse text-left text-base">
          <thead className="sticky top-0 bg-paper">
            <tr>
              <th scope="col" className="px-3 py-2 font-semibold">
                Row
              </th>
              <th scope="col" className="px-3 py-2 font-semibold">
                Column
              </th>
              <th scope="col" className="px-3 py-2 font-semibold">
                Problem
              </th>
            </tr>
          </thead>
          <tbody>
            {issues.map((issue) => (
              <tr
                key={`${issue.rowNumber}|${issue.column ?? ""}|${issue.message}`}
                className="border-t border-line align-top"
              >
                <td className="tabular px-3 py-2">{issue.rowNumber}</td>
                <td className="px-3 py-2">{issue.column ?? "—"}</td>
                <td className="px-3 py-2">{issue.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total > issues.length ? (
        <p className="mt-2 text-base text-muted">
          And {groupThousands(total - issues.length)} more not listed here.
        </p>
      ) : null}
    </div>
  );
}
