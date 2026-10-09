import { requireEnv } from "./env";
import { runMigrations } from "./migrations";

// `pnpm db:migrate`: applies pending migrations to DATABASE_URL.
const url = requireEnv("DATABASE_URL");
const started = Date.now();
await runMigrations(url);
console.log(
  `Migrations applied to ${new URL(url).pathname.slice(1)} in ${Date.now() - started} ms`,
);
