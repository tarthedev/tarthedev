import { createDb } from "../client";
import { requireEnv } from "../env";
import { generateDemoData } from "./generate";
import { DemoSeedRefusedError, seedDemoData } from "./load";

// `pnpm db:seed [--seed=N]`: loads deterministic demo data into DATABASE_URL.
if (process.env.NODE_ENV === "production") {
  console.error("Refusing to load demo data with NODE_ENV=production.");
  process.exit(1);
}

const seedArg = process.argv.find((arg) => arg.startsWith("--seed="));
const seed = seedArg ? Number.parseInt(seedArg.slice("--seed=".length), 10) : undefined;
if (seed !== undefined && !Number.isSafeInteger(seed)) {
  console.error(`Invalid --seed: ${seedArg}`);
  process.exit(1);
}

const url = requireEnv("DATABASE_URL");
const { db, close } = createDb(url, { max: 1 });
try {
  const data = generateDemoData(seed === undefined ? {} : { seed });
  const { summary, ms } = await seedDemoData(db, data);
  const dollars = (cents: number) => {
    const whole = (cents - (cents % 100)) / 100;
    const rest = String(Math.abs(cents % 100)).padStart(2, "0");
    return `$${whole.toLocaleString("en-US")}.${rest}`;
  };
  console.log(`Demo data loaded into ${new URL(url).pathname.slice(1)} in ${ms} ms`);
  console.log(`Seed ${data.options.seed}, ${data.options.startDate} to ${data.options.endDate}`);
  console.table(summary.counts);
  console.log(`Invoice totals: ${dollars(summary.totals.invoiceTotalCents)}`);
  console.log(`Open balance: ${dollars(summary.totals.openBalanceCents)}`);
  console.log(`Average service ticket: ${dollars(summary.averageServiceTicketCents)}`);
  console.log(`Customers with a membership: ${summary.membershipShareBps / 100}%`);
  console.log("Tech-weeks per ladder level:", summary.ladderWeeks);
} catch (error) {
  if (error instanceof DemoSeedRefusedError) {
    console.error(error.message);
    process.exitCode = 1;
  } else {
    throw error;
  }
} finally {
  await close();
}
