import type { ReportType } from "../mappings/types";
import { customersHandler } from "./customers";
import { equipmentHandler } from "./equipment";
import { invoicesHandler } from "./invoices";
import { membershipsHandler } from "./memberships";
import { paymentsHandler } from "./payments";
import { pricebookHandler } from "./pricebook";
import { techniciansHandler } from "./technicians";
import { timesheetsHandler } from "./timesheets";
import type { ReportHandler } from "./types";

/**
 * Runs `use` with the handler for `type`, keeping the handler's own field
 * and row types inside `use`.
 */
export function withHandler<T>(
  type: ReportType,
  use: <F extends string, R>(handler: ReportHandler<F, R>) => T,
): T {
  switch (type) {
    case "technicians":
      return use(techniciansHandler);
    case "pricebook":
      return use(pricebookHandler);
    case "customers":
      return use(customersHandler);
    case "equipment":
      return use(equipmentHandler);
    case "memberships":
      return use(membershipsHandler);
    case "invoices":
      return use(invoicesHandler);
    case "payments":
      return use(paymentsHandler);
    case "timesheets":
      return use(timesheetsHandler);
  }
}
