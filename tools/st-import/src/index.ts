/**
 * @dwrg/st-import: ServiceTitan report-export importer (docs/06). There is no
 * ServiceTitan API: report exports are uploaded on the office Import page,
 * previewed, imported idempotently on ServiceTitan IDs, and proved against
 * ServiceTitan's own summary totals. Nothing is ever written back to
 * ServiceTitan.
 *
 * Typical flow (the API calls these; it checks roles and stores the raw file):
 *
 *   const p = await preview({ db, csvText });                 // detect, map, list problems
 *   const r = await runImport({ db, csvText, reportType: p.reportType, fileName, uploadedBy });
 *   const c = await compareWithSummary({ db, batchId: r.batchId, summary });
 *
 * Run report types in REPORT_TYPES order: technicians, pricebook, customers,
 * equipment, memberships, invoices (jobs, invoices, lines and costs),
 * payments, timesheets. Later reports refer to records from earlier ones.
 */

export type { RowOutcome } from "./context";
export { CsvParseError, type CsvRecord, type ParsedCsv, parseCsv, toCsv } from "./csv";
export {
  describeDatabaseError,
  RowError,
  StImportError,
  StImportFailedError,
} from "./errors";
export {
  type ColumnMatch,
  type DetectCandidate,
  type DetectResult,
  detectReportType,
  matchColumns,
} from "./headers";
export {
  BILLING_STAGE_NAMES,
  BUSINESS_UNIT_NAMES,
  CUSTOMER_TYPE_NAMES,
  customersMapping,
  EQUIPMENT_KIND_NAMES,
  EQUIPMENT_STATUS_NAMES,
  equipmentMapping,
  type FieldSpec,
  INVOICE_STATUS_NAMES,
  invoicesMapping,
  isReportType,
  JOB_PRIORITY_NAMES,
  JOB_STATUS_NAMES,
  labelOf,
  lookupValue,
  MAPPINGS,
  MEMBERSHIP_STATUS_NAMES,
  membershipsMapping,
  normalizeLabel,
  PAYMENT_METHOD_NAMES,
  PRICEBOOK_KIND_NAMES,
  paymentsMapping,
  pricebookMapping,
  REPORT_TYPES,
  type ReportMapping,
  type ReportType,
  ROLE_NAMES,
  SKILL_NAMES,
  TIME_ENTRY_KIND_NAMES,
  techniciansMapping,
  timesheetsMapping,
  type ValueSynonyms,
  YES_NO,
} from "./mappings";
export {
  type ImportCounts,
  type ImportIssue,
  type ImportResult,
  type PreviewOptions,
  type PreviewResult,
  type PreviewRow,
  preview,
  type RunImportOptions,
  runImport,
} from "./pipeline";
export { type Quantity, type RowIssue, RowReader } from "./reader";
export { jobTypeCode } from "./reports/invoices";
export {
  formatUsDate,
  formatUsDateTime,
  localDateTimeOf,
  parseInstant,
  parseLocalDate,
  zonedTimeToInstant,
} from "./time";
export {
  ALL_YEARS,
  type Comparison,
  type ComparisonRow,
  type ComparisonStatus,
  compareWithSummary,
  computeTotals,
  NO_BUSINESS_UNIT,
  type SummaryRow,
  TOTALS_MEANING,
  type TotalRow,
} from "./totals";
