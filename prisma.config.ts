import { defineConfig } from "prisma/config";

// Prisma 7 no longer auto-loads .env. Load it here so `prisma migrate` and
// `prisma studio` work from a plain shell without exporting DATABASE_URL.
// In Docker/production the variable is already in the environment and the
// missing-file case is expected, not an error.
for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // no such file — fall through to the ambient environment
  }
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // Read straight from the environment rather than via prisma/config's env(),
    // which throws when the variable is absent. `prisma generate` needs no
    // database connection, and it runs during the Docker build before one
    // exists. Commands that genuinely need a URL (migrate, studio) still fail
    // with Prisma's own clear message when it is missing.
    url: process.env.DATABASE_URL,
  },
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
});
