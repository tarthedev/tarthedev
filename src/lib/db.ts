import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma";
import { env } from "@/lib/env";

/**
 * Prisma 7 constructs the client with a driver adapter rather than reading a
 * URL out of the schema. In dev the instance is cached on globalThis so Next's
 * hot reload does not open a new pool on every edit.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: env().DATABASE_URL });
  return new PrismaClient({
    adapter,
    log: env().NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();

if (env().NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
