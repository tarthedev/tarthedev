import { type Cents, type LocalDate, mulDivHalfUp, parseMoney } from "@dwrg/core";
import type { ReportMapping } from "./mappings/types";
import { labelOf, lookupValue, type ValueSynonyms, YES_NO } from "./mappings/values";
import { parseInstant, parseLocalDate } from "./time";

/** The largest amount an integer cents column holds (2^31 - 1). */
const MAX_CENTS = 2_147_483_647;

/** One problem with a row, in words for the Import page. */
export interface RowIssue {
  /** The file column the problem is in, when there is one. */
  column: string | null;
  message: string;
}

/** A decimal quantity, exact: `text` for the numeric(12,3) column, `milli` = quantity x 1000. */
export interface Quantity {
  text: string;
  milli: number;
}

/**
 * Reads one CSV record through a report mapping into typed values. Every
 * getter returns `undefined` when the file has no such column (so imports
 * leave that field alone) and `null` when the cell is blank. The `required*`
 * getters record "is blank" instead; when a row has issues it is rejected,
 * so their placeholder return values are never stored.
 */
export class RowReader<F extends string> {
  readonly issues: RowIssue[] = [];

  constructor(
    private readonly mapping: ReportMapping<F>,
    private readonly columns: Partial<Record<F, string>>,
    private readonly cells: Readonly<Record<string, string>>,
  ) {}

  get ok(): boolean {
    return this.issues.length === 0;
  }

  /** The header this field is read from (or its usual name if the file lacks it). */
  label(field: F): string {
    return this.columns[field] ?? this.mapping.fields[field].headers[0] ?? field;
  }

  has(field: F): boolean {
    return this.columns[field] !== undefined;
  }

  /** The trimmed cell, or undefined when the file has no such column. */
  cell(field: F): string | undefined {
    const header = this.columns[field];
    if (header === undefined) return undefined;
    return (this.cells[header] ?? "").trim();
  }

  fail(field: F | null, message: string): void {
    this.issues.push({ column: field === null ? null : this.label(field), message });
  }

  /**
   * Reads a cell with `convert` (which returns null for a value it can't
   * read); a bad value is recorded as `<column>: "<value>" <expected>.`
   */
  convert<T>(
    field: F,
    convert: (value: string) => T | null,
    expected: string,
  ): T | null | undefined {
    const value = this.cell(field);
    if (value === undefined) return undefined;
    if (value === "") return null;
    const converted = convert(value);
    if (converted === null) {
      this.fail(field, `${this.label(field)}: "${value}" ${expected}.`);
      return null;
    }
    return converted;
  }

  /** `value`, or records that the cell (or column) is missing and returns `placeholder`. */
  need<T>(field: F, value: T | null | undefined, placeholder: T): T {
    if (value !== null && value !== undefined) return value;
    const cell = this.cell(field);
    if (cell === undefined) this.fail(field, `The file has no ${this.label(field)} column.`);
    else if (cell === "") this.fail(field, `${this.label(field)} is blank.`);
    return placeholder;
  }

  text(field: F): string | null | undefined {
    const value = this.cell(field);
    if (value === undefined) return undefined;
    return value === "" ? null : value;
  }

  requiredText(field: F): string {
    return this.need(field, this.text(field), "");
  }

  /**
   * A ServiceTitan ID. Rejects numbers a spreadsheet turned into scientific
   * notation ("1.23457E+11"), which would no longer match the real ID.
   */
  id(field: F): string | null | undefined {
    return this.convert(
      field,
      (value) => (/^\d+(\.\d+)?E[+-]?\d+$/i.test(value) ? null : value),
      "looks like a number a spreadsheet shortened (scientific notation); export the file again without opening it in a spreadsheet",
    );
  }

  requiredId(field: F): string {
    return this.need(field, this.id(field), "");
  }

  /**
   * Money in integer cents, parsed with @dwrg/core parseMoney ("$1,234.50" ->
   * 123450). Money columns are 32-bit integers, so amounts past
   * $21,474,836.47 are refused here rather than by the database.
   */
  money(field: F): Cents | null | undefined {
    const cents = this.convert(
      field,
      (value) => {
        try {
          return parseMoney(value);
        } catch {
          return null;
        }
      },
      "is not a money amount like $1,234.50",
    );
    if (typeof cents === "number" && Math.abs(cents) > MAX_CENTS) {
      this.fail(field, `${this.label(field)}: "${this.cell(field)}" is too large.`);
      return null;
    }
    return cents;
  }

  requiredMoney(field: F): Cents {
    return this.need(field, this.money(field), 0);
  }

  /** A business-local date ("10/6/2025" or "2025-10-06"). */
  date(field: F): LocalDate | null | undefined {
    return this.convert(field, parseLocalDate, "is not a date like 10/6/2025");
  }

  requiredDate(field: F): LocalDate {
    return this.need(field, this.date(field), "1970-01-01");
  }

  /** A business-local date and time ("10/6/2025 2:30 PM"), or an ISO instant with an offset. */
  instant(field: F): Date | null | undefined {
    return this.convert(field, parseInstant, "is not a date and time like 10/6/2025 2:30 PM");
  }

  requiredInstant(field: F): Date {
    return this.need(field, this.instant(field), new Date(0));
  }

  /** A whole number, optionally limited to [min, max]. */
  int(field: F, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER) {
    return this.convert(
      field,
      (value) => {
        const text = value.replaceAll(",", "");
        if (!/^-?\d+$/.test(text)) return null;
        const n = Number(text);
        return Number.isSafeInteger(n) && n >= min && n <= max ? n : null;
      },
      min === 0 ? "is not a whole number of zero or more" : "is not a whole number in range",
    );
  }

  requiredInt(field: F, min?: number, max?: number): number {
    return this.need(field, this.int(field, min, max), 0);
  }

  /** A coordinate or other measurement (never money). */
  coordinate(field: F, limit: number): number | null | undefined {
    return this.convert(
      field,
      (value) => {
        if (!/^-?\d+(\.\d+)?$/.test(value)) return null;
        const n = Number(value);
        return Math.abs(n) <= limit ? n : null;
      },
      `is not a coordinate between -${limit} and ${limit}`,
    );
  }

  /** An exact quantity with up to 3 decimals ("2", "1.5", "1,000.250"). */
  quantity(field: F): Quantity | null | undefined {
    return this.convert(
      field,
      (value) => {
        const match = /^(-?)(\d{1,3}(?:,\d{3})+|\d+)?(?:\.(\d{0,3}))?$/.exec(value);
        if (!match || (match[2] === undefined && match[3] === undefined)) return null;
        const whole = (match[2] ?? "0").replaceAll(",", "");
        const fraction = (match[3] ?? "").padEnd(3, "0");
        const milli = Number(whole) * 1000 + Number(fraction);
        if (!Number.isSafeInteger(milli) || whole.length > 9) return null;
        const negative = match[1] === "-" && milli !== 0;
        return {
          text: `${negative ? "-" : ""}${Number(whole)}.${fraction}`,
          milli: negative ? -milli : milli,
        };
      },
      "is not a quantity with up to 3 decimal places",
    );
  }

  /** Decimal hours ("1.25") as whole minutes, rounded half-up (75). */
  hoursAsMinutes(field: F): number | null | undefined {
    return this.convert(
      field,
      (value) => {
        const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(value);
        if (!match) return null;
        const digits = match[2] ?? "";
        const scale = 10 ** digits.length;
        const scaled = Number(match[1]) * scale + Number(digits || "0");
        if (!Number.isSafeInteger(scaled * 60)) return null;
        return mulDivHalfUp(scaled, 60, scale);
      },
      "is not a number of hours like 1.5",
    );
  }

  bool(field: F): boolean | null | undefined {
    return this.convert(
      field,
      (value) => {
        const answer = lookupValue(YES_NO, value);
        return answer === null ? null : answer === "yes";
      },
      "is not Yes or No",
    );
  }

  /** A US phone number as E.164 ("(252) 555-0123" -> "+12525550123"). */
  phone(field: F): string | null | undefined {
    return this.convert(
      field,
      (value) => {
        if (!/^[\d\s()+.-]+$/.test(value)) return null;
        const digits = value.replace(/\D/g, "");
        if (digits.length === 10) return `+1${digits}`;
        if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
        return null;
      },
      "is not a 10-digit US phone number",
    );
  }

  email(field: F): string | null | undefined {
    return this.convert(
      field,
      (value) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null),
      "is not an email address",
    );
  }

  /** One of our allowed values, by any of its labels in the mapping config. */
  choice<V extends string>(field: F, synonyms: ValueSynonyms<V>): V | null | undefined {
    const examples = (Object.keys(synonyms) as V[])
      .slice(0, 6)
      .map((value) => labelOf(synonyms, value))
      .join(", ");
    return this.convert(
      field,
      (value) => lookupValue(synonyms, value),
      `is not a value we know (for example ${examples}); add it to the mapping config if it is right`,
    );
  }

  requiredChoice<V extends string>(field: F, synonyms: ValueSynonyms<V>, placeholder: V): V {
    return this.need(field, this.choice(field, synonyms), placeholder);
  }

  /** A list in one cell ("HVAC, Plumbing"), split on commas, semicolons or pipes. */
  list(field: F): string[] | undefined {
    const value = this.cell(field);
    if (value === undefined) return undefined;
    return value
      .split(/[,;|]/)
      .map((part) => part.trim())
      .filter((part) => part !== "");
  }

  /** Each item of a list cell mapped to one of our values; unknown items are issues. */
  choices<V extends string>(field: F, synonyms: ValueSynonyms<V>): V[] | undefined {
    const items = this.list(field);
    if (items === undefined) return undefined;
    const out: V[] = [];
    for (const item of items) {
      const value = lookupValue(synonyms, item);
      if (value === null) {
        this.fail(field, `${this.label(field)}: "${item}" is not a value we know.`);
      } else if (!out.includes(value)) {
        out.push(value);
      }
    }
    return out;
  }
}
