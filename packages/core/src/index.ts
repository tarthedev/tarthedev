/**
 * @dwrg/core: pure business logic. No database, network or clock access; time is passed in.
 * Money is integer cents, rates are basis points, rounding is half-up per line.
 * The pay rules implement docs/02-commission-plan.md.
 */

export * from "./money";
export * from "./pay/callbacks";
export * from "./pay/commission";
export * from "./pay/credit";
export * from "./pay/gross-profit";
export * from "./pay/ladder";
export * from "./pay/office-spiffs";
export * from "./pay/overtime";
export * from "./pay/payability";
export * from "./pay/payrun";
export * from "./pay/spiffs";
export * from "./settings/effective";
export * from "./time/weeks";
