import { parse } from "csv-parse/sync";

/**
 * CSV reading for ServiceTitan report exports.
 *
 * Row numbers are spreadsheet row numbers: the header row is row 1 when it is
 * the first line, and every record (blank lines included) counts as one row,
 * the way Excel or Numbers shows the file. Cell text is kept exactly as read;
 * trimming happens later, when a cell is mapped to a field.
 */

export interface CsvRecord {
  /** Spreadsheet row number of this record (the header is usually row 1). */
  rowNumber: number;
  /**
   * The raw cells keyed by header, exactly as read. Duplicate headers get
   * " (2)", " (3)" ...; blank headers and cells past the header are keyed
   * "Column N".
   */
  cells: Record<string, string>;
  /** Number of cells in the record. */
  cellCount: number;
}

export interface ParsedCsv {
  /** Header names as unique keys of `CsvRecord.cells`, in file order. */
  headers: string[];
  /** Spreadsheet row number of the header row. */
  headerRowNumber: number;
  /** Data records after the header. Blank records are left out. */
  records: CsvRecord[];
}

export class CsvParseError extends Error {
  override name = "CsvParseError";
}

/** How many of the first non-blank records may be a title or date-range preamble. */
const HEADER_SEARCH_ROWS = 10;

/**
 * Parses CSV text (a UTF-8 byte-order mark is ignored). The header row is the
 * first of the first ten non-blank rows that fills at least two cells and at
 * least half as many as the widest of those rows, which skips the title and
 * date-range lines some report exports start with.
 */
export function parseCsv(text: string): ParsedCsv {
  let rows: string[][];
  try {
    rows = parse(text, {
      bom: true,
      relax_column_count: true,
      skip_empty_lines: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CsvParseError(`The file is not valid CSV: ${message}`);
  }

  const nonBlank = rows
    .map((cells, index) => ({ cells, index }))
    .filter((row) => !isBlank(row.cells));
  if (nonBlank.length === 0) throw new CsvParseError("The file has no rows.");

  // Preamble lines (a title, "Date Range: ...") fill one or two cells; the
  // header fills at least two and about as many as the widest early row.
  const early = nonBlank.slice(0, HEADER_SEARCH_ROWS);
  const widest = Math.max(...early.map((row) => filledCount(row.cells)));
  const header =
    early.find((row) => {
      const filled = filledCount(row.cells);
      return filled >= 2 && filled * 2 >= widest;
    }) ?? nonBlank[0];
  if (!header) throw new CsvParseError("The file has no header row.");

  const headers = uniqueHeaders(header.cells);
  const records: CsvRecord[] = [];
  for (let index = header.index + 1; index < rows.length; index++) {
    const cells = rows[index] ?? [];
    if (isBlank(cells)) continue;
    const keyed: Record<string, string> = {};
    cells.forEach((cell, position) => {
      keyed[headers[position] ?? `Column ${position + 1}`] = cell;
    });
    records.push({ rowNumber: index + 1, cells: keyed, cellCount: cells.length });
  }
  return { headers, headerRowNumber: header.index + 1, records };
}

function isBlank(cells: readonly string[]): boolean {
  return cells.every((cell) => cell.trim() === "");
}

function filledCount(cells: readonly string[]): number {
  return cells.filter((cell) => cell.trim() !== "").length;
}

function uniqueHeaders(cells: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return cells.map((cell, position) => {
    const base = cell.trim() === "" ? `Column ${position + 1}` : cell.trim();
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base} (${count})`;
  });
}

/** Quotes a cell when it holds a comma, quote, line break or edge spaces. */
function quoteCell(value: string): string {
  if (/[",\r\n]/.test(value) || value !== value.trim()) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

/** Writes rows as CSV with CRLF line endings (what spreadsheet exports use). */
export function toCsv(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const lines = [headers, ...rows].map((row) => row.map(quoteCell).join(","));
  return `${lines.join("\r\n")}\r\n`;
}
