import { defineConfig } from "drizzle-kit";

// `generate` only reads the schema; `migrate`/`studio` use DATABASE_URL.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://localhost:5432/dwrg_dev" },
  strict: true,
  verbose: true,
});
