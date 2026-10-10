import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { REPORT_TYPES, type ReportType } from "../mappings/types";
import {
  buildDemoExports,
  DEMO_FILE_NAMES,
  DEMO_SUMMARY_FILE,
  type DemoExports,
  type DemoSummaryFile,
} from "./export";

/** tools/st-import/fixtures/demo */
export const DEMO_FIXTURES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "fixtures",
  "demo",
);

/** Writes the demo CSVs and summary.json; returns the paths written. */
export function writeDemoFixtures(
  dir: string = DEMO_FIXTURES_DIR,
  exports: DemoExports = buildDemoExports(),
): string[] {
  mkdirSync(dir, { recursive: true });
  const written: string[] = [];
  for (const type of REPORT_TYPES) {
    const path = join(dir, DEMO_FILE_NAMES[type]);
    writeFileSync(path, exports.files[type], "utf8");
    written.push(path);
  }
  const summaryPath = join(dir, DEMO_SUMMARY_FILE);
  writeFileSync(summaryPath, `${JSON.stringify(exports.summary, null, 2)}\n`, "utf8");
  written.push(summaryPath);
  return written;
}

/** Reads the committed demo fixtures. */
export function readDemoFixtures(dir: string = DEMO_FIXTURES_DIR): DemoExports {
  const files = {} as Record<ReportType, string>;
  for (const type of REPORT_TYPES) {
    files[type] = readFileSync(join(dir, DEMO_FILE_NAMES[type]), "utf8");
  }
  const summary = JSON.parse(readFileSync(join(dir, DEMO_SUMMARY_FILE), "utf8")) as DemoSummaryFile;
  return { files, summary };
}
