/**
 * Demo data (import from "@dwrg/db/demo"): the deterministic generator, its
 * summary, and the loader behind `pnpm db:seed`.
 */
export {
  DEMO_TAX_BPS,
  MEMBER_DISCOUNT_BPS,
  MEMBERSHIP_ITEM_CODE,
  MEMBERSHIP_PRICE_CENTS,
  PRICEBOOK,
  TOWNS,
} from "./catalog";
export {
  DEMO_EMAIL_DOMAIN,
  DEMO_END_DATE,
  DEMO_REASON,
  DEMO_SEED,
  DEMO_ST_PREFIX,
  DEMO_TABLE_ORDER,
  type DemoData,
  type DemoOptions,
  type DemoRow,
  type DemoTableName,
  generateDemoData,
  PILOT_CREW_SETTING_KEY,
  type PilotCrewSetting,
  type ResolvedDemoOptions,
  resolveDemoOptions,
} from "./generate";
export { DemoSeedRefusedError, findNonDemoRows, type SeedResult, seedDemoData } from "./load";
export {
  DEMO_LADDER,
  type DemoLadderLevel,
  type DemoSummary,
  ladderLevel,
  summarizeDemoData,
  weeklyTechGp,
} from "./summary";
export { BUSINESS_TIME_ZONE, localDay, localTime, mondayOf } from "./time";
