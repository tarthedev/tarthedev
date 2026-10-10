import { customersMapping } from "./customers";
import { equipmentMapping } from "./equipment";
import { invoicesMapping } from "./invoices";
import { membershipsMapping } from "./memberships";
import { paymentsMapping } from "./payments";
import { pricebookMapping } from "./pricebook";
import { techniciansMapping } from "./technicians";
import { timesheetsMapping } from "./timesheets";
import type { ReportMapping, ReportType } from "./types";

export { customersMapping } from "./customers";
export { equipmentMapping } from "./equipment";
export { invoicesMapping } from "./invoices";
export { membershipsMapping } from "./memberships";
export { paymentsMapping } from "./payments";
export { pricebookMapping } from "./pricebook";
export { techniciansMapping } from "./technicians";
export { timesheetsMapping } from "./timesheets";
export * from "./types";
export * from "./values";

/** Every report mapping, by report type. */
export const MAPPINGS: Readonly<Record<ReportType, ReportMapping>> = {
  technicians: techniciansMapping,
  pricebook: pricebookMapping,
  customers: customersMapping,
  equipment: equipmentMapping,
  memberships: membershipsMapping,
  invoices: invoicesMapping,
  payments: paymentsMapping,
  timesheets: timesheetsMapping,
};
