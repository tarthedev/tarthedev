/**
 * Demo ServiceTitan report exports (import from "@dwrg/st-import/demo").
 * Kept apart from the main entry so the importer never loads the demo
 * generator (and its Faker dependency) at run time.
 */
export {
  buildDemoExports,
  DEMO_EXPORT_OPTIONS,
  DEMO_FILE_NAMES,
  DEMO_SUMMARY_FILE,
  type DemoExports,
  type DemoSummaryFile,
} from "./export";
export { DEMO_FIXTURES_DIR, readDemoFixtures, writeDemoFixtures } from "./fixtures";
