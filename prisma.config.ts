import { defineConfig, env } from "prisma/config";

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
    url: env("DATABASE_URL"),
  },
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
});
