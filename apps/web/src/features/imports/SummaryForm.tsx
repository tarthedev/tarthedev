import {
  BUSINESS_UNIT_CODES,
  type ImportBatchDetail,
  type ImportSummaryRow,
  type ImportTotal,
} from "@dwrg/shared";
import { type FormEvent, useState } from "react";
import { Alert, Button, Field, SelectField } from "../../components/ui";
import { messageOf } from "../../lib/api";
import { formatCents, groupThousands } from "../../lib/format";
import { BUSINESS_UNIT_LABELS, businessUnitLabel } from "../../lib/labels";
import { yearLabel } from "./ImportReport";

interface Line {
  key: string;
  businessUnit: string;
  year: string;
  count: string;
  total: string;
  /** Typed in by hand (a line only ServiceTitan's summary has). */
  added: boolean;
}

/** One line per department and year, prefilled with what was entered before. */
export function linesFrom(totals: readonly ImportTotal[]): Line[] {
  const lines = new Map<string, Line>();
  for (const t of totals) {
    const key = `${t.businessUnitCode}|${t.year}`;
    const line = lines.get(key) ?? {
      key,
      businessUnit: t.businessUnitCode,
      year: t.year === 0 ? "" : String(t.year),
      count: "",
      total: "",
      added: false,
    };
    if (t.servicetitanSummary !== null) {
      if (t.metric === "count") line.count = String(t.servicetitanSummary);
      else line.total = formatCents(t.servicetitanSummary);
    }
    lines.set(key, line);
  }
  return [...lines.values()];
}

const WHOLE = /^\d{1,3}(,?\d{3})*$/;
const MONEY = /^-?\$?\s*\d{1,3}(,?\d{3})*(\.\d{1,2})?$/;

/** The rows to send, or the problems to show (by line key). */
export function summaryRows(lines: readonly Line[]): {
  rows: ImportSummaryRow[];
  problems: Record<string, string>;
} {
  const rows: ImportSummaryRow[] = [];
  const problems: Record<string, string> = {};
  for (const line of lines) {
    const count = line.count.trim();
    const total = line.total.trim();
    if (!count && !total) continue;
    if (count && !WHOLE.test(count)) {
      problems[line.key] = "The count must be a whole number, like 1,204.";
      continue;
    }
    if (total && !MONEY.test(total)) {
      problems[line.key] = "Write dollars as ServiceTitan shows them, like $12,345.67.";
      continue;
    }
    const year = line.year.trim();
    if (year && !/^\d{4}$/.test(year)) {
      problems[line.key] = "The year must be four digits, like 2026.";
      continue;
    }
    rows.push({
      businessUnit: line.businessUnit === "none" ? null : line.businessUnit,
      year: year ? Number(year) : null,
      ...(count ? { count: Number(count.replaceAll(",", "")) } : {}),
      ...(total ? { total } : {}),
    });
  }
  return { rows, problems };
}

/**
 * Type in the figures from ServiceTitan's own summary report; the server puts
 * them next to ours and works out the differences (in cents). Saving again
 * replaces what was entered before.
 */
export function SummaryForm({
  detail,
  onSubmit,
}: {
  detail: ImportBatchDetail;
  onSubmit: (rows: ImportSummaryRow[]) => Promise<void>;
}) {
  const hasDollars = detail.totalsMeaning?.dollars != null;
  const [lines, setLines] = useState<Line[]>(() => linesFrom(detail.totals));
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const update = (key: string, patch: Partial<Line>) => {
    setSaved(false);
    setLines((all) => all.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const { rows, problems: found } = summaryRows(lines);
    setProblems(found);
    setSaved(false);
    if (Object.keys(found).length > 0) {
      setError("Check the lines marked below.");
      return;
    }
    if (rows.length === 0) {
      setError("Enter at least one figure from ServiceTitan's summary.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(rows);
      setSaved(true);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <p className="text-base text-muted">
        Run the matching summary report in ServiceTitan for the same dates, then type its figures
        here. Leave a box empty if the summary doesn't show it.
      </p>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {saved ? (
        <Alert tone="success">Saved. The totals above now show the comparison.</Alert>
      ) : null}
      <ul className="space-y-3">
        {lines.map((line) => {
          const ours = detail.totals.filter((t) => `${t.businessUnitCode}|${t.year}` === line.key);
          const oursCount = ours.find((t) => t.metric === "count")?.ours;
          const oursDollars = ours.find((t) => t.metric === "dollars")?.ours;
          return (
            <li key={line.key} className="rounded-xl border border-line px-4 py-3">
              {line.added ? (
                <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <SelectField
                    label="Department"
                    value={line.businessUnit}
                    onChange={(e) => update(line.key, { businessUnit: e.target.value })}
                  >
                    <option value="none">All (no department)</option>
                    {BUSINESS_UNIT_CODES.map((code) => (
                      <option key={code} value={code}>
                        {BUSINESS_UNIT_LABELS[code]}
                      </option>
                    ))}
                  </SelectField>
                  <Field
                    label="Year (blank for all years)"
                    inputMode="numeric"
                    value={line.year}
                    onChange={(e) => update(line.key, { year: e.target.value })}
                  />
                </div>
              ) : (
                <p className="mb-2 text-lg font-semibold text-navy">
                  {businessUnitLabel(line.businessUnit)} · {yearLabel(Number(line.year || 0))}
                </p>
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field
                  label="ServiceTitan count"
                  inputMode="numeric"
                  hint={oursCount === undefined ? undefined : `Ours: ${groupThousands(oursCount)}`}
                  value={line.count}
                  onChange={(e) => update(line.key, { count: e.target.value })}
                />
                {hasDollars ? (
                  <Field
                    label="ServiceTitan dollars"
                    inputMode="decimal"
                    placeholder="$0.00"
                    hint={
                      oursDollars === undefined ? undefined : `Ours: ${formatCents(oursDollars)}`
                    }
                    value={line.total}
                    onChange={(e) => update(line.key, { total: e.target.value })}
                  />
                ) : null}
              </div>
              {problems[line.key] ? (
                <p className="mt-2 font-semibold text-bad">{problems[line.key]}</p>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" busy={busy}>
          Compare
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            setLines((all) => [
              ...all,
              {
                key: `added-${all.length}-${Date.now()}`,
                businessUnit: "none",
                year: "",
                count: "",
                total: "",
                added: true,
              },
            ])
          }
        >
          Add a line ServiceTitan has
        </Button>
      </div>
    </form>
  );
}
