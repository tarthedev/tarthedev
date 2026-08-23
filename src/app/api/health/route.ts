import { prisma } from "@/lib/db";

/**
 * Liveness and readiness in one endpoint, used by the Docker healthcheck and
 * by the reverse proxy. Unauthenticated by design, and deliberately reveals
 * nothing beyond whether the process can reach its database.
 */
export async function GET(): Promise<Response> {
  const startedAt = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json(
      { status: "ok", database: "up", latencyMs: Date.now() - startedAt },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { status: "degraded", database: "down" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
