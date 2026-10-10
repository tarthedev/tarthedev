/**
 * pnpm --filter @dwrg/st-import demo-csvs [--out=<dir>]
 *
 * Writes ServiceTitan-shaped demo report exports and their summary totals
 * (fixtures/demo by default), generated from @dwrg/db demo data with a fixed
 * seed, so the output is the same on every machine.
 */
import { statSync } from "node:fs";
import { relative } from "node:path";
import { DEMO_FIXTURES_DIR, writeDemoFixtures } from "./fixtures";

const outArg = process.argv.slice(2).find((arg) => arg.startsWith("--out="));
const dir = outArg ? outArg.slice("--out=".length) : DEMO_FIXTURES_DIR;
const started = Date.now();
const paths = writeDemoFixtures(dir);
for (const path of paths) {
  const kb = (statSync(path).size / 1024).toFixed(1);
  console.log(`${relative(process.cwd(), path)}  ${kb} KB`);
}
console.log(`Wrote ${paths.length} files in ${Date.now() - started} ms.`);
