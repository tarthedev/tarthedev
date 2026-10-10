import { MAPPINGS } from "./mappings";
import {
  normalizeLabel,
  REPORT_TYPES,
  type ReportMapping,
  type ReportType,
} from "./mappings/types";

/** Which file column feeds each field of a report. */
export interface ColumnMatch<F extends string = string> {
  reportType: ReportType;
  /** Field -> the header in the file that feeds it (absent when the file has no such column). */
  columns: Partial<Record<F, string>>;
  /** Required fields with no column, by their usual header name. */
  missingRequired: string[];
  /** File headers no field uses (ignored on import, kept in the raw rows). */
  unmatchedHeaders: string[];
}

/**
 * Matches file headers to a report's fields. When two file columns mean the
 * same field, the one whose name comes first in the mapping wins and the
 * other is left unmatched.
 */
export function matchColumns<F extends string>(
  mapping: ReportMapping<F>,
  headers: readonly string[],
): ColumnMatch<F> {
  const byLabel = new Map<string, string>();
  for (const header of headers) {
    const label = normalizeLabel(header);
    if (label !== "" && !byLabel.has(label)) byLabel.set(label, header);
  }
  const columns: Partial<Record<F, string>> = {};
  const used = new Set<string>();
  const missingRequired: string[] = [];
  for (const [field, spec] of Object.entries(mapping.fields) as [
    F,
    ReportMapping["fields"][string],
  ][]) {
    let found: string | undefined;
    for (const name of spec.headers) {
      const header = byLabel.get(normalizeLabel(name));
      if (header !== undefined && !used.has(header)) {
        found = header;
        break;
      }
    }
    if (found !== undefined) {
      columns[field] = found;
      used.add(found);
    } else if (spec.required) {
      missingRequired.push(spec.headers[0] ?? field);
    }
  }
  return {
    reportType: mapping.type,
    columns,
    missingRequired,
    unmatchedHeaders: headers.filter((header) => !used.has(header)),
  };
}

export interface DetectCandidate {
  reportType: ReportType;
  label: string;
  /** Required columns the file lacks for this report type. */
  missingRequired: string[];
  /** How many of the file's headers this report type uses. */
  matchedHeaders: number;
  /** matchedHeaders / all headers, in basis points (10000 = every column is understood). */
  scoreBps: number;
}

export interface DetectResult {
  /** The detected report type, or null when no type fits or two fit equally well. */
  reportType: ReportType | null;
  /** Every report type, best fit first. */
  candidates: DetectCandidate[];
  /** Why nothing was detected, in words for the Import page. */
  reason?: string;
}

/**
 * Detects the report type from the header row: the type with every required
 * column present that understands the largest share of the file's columns.
 */
export function detectReportType(headers: readonly string[]): DetectResult {
  const nonBlank = headers.filter((header) => normalizeLabel(header) !== "");
  const candidates: DetectCandidate[] = REPORT_TYPES.map((type) => {
    const mapping = MAPPINGS[type];
    const match = matchColumns(mapping, nonBlank);
    const matchedHeaders = nonBlank.length - match.unmatchedHeaders.length;
    return {
      reportType: type,
      label: mapping.label,
      missingRequired: match.missingRequired,
      matchedHeaders,
      scoreBps: nonBlank.length === 0 ? 0 : Math.floor((matchedHeaders * 10_000) / nonBlank.length),
    };
  }).sort(
    (a, b) =>
      Number(a.missingRequired.length > 0) - Number(b.missingRequired.length > 0) ||
      b.scoreBps - a.scoreBps ||
      b.matchedHeaders - a.matchedHeaders,
  );

  const fitting = candidates.filter((c) => c.missingRequired.length === 0);
  const [best, next] = fitting;
  if (!best) {
    return {
      reportType: null,
      candidates,
      reason: "These columns don't match any ServiceTitan report we know. Pick the report type.",
    };
  }
  if (next && next.scoreBps === best.scoreBps && next.matchedHeaders === best.matchedHeaders) {
    return {
      reportType: null,
      candidates,
      reason: `These columns fit both "${best.label}" and "${next.label}". Pick the report type.`,
    };
  }
  return { reportType: best.reportType, candidates };
}
