import { getUsageSummary } from "@/lib/ai/usage";
import { ok, withAuth } from "@/lib/http/api";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";

/** GET /api/ai/usage — the cost dashboard's data source. */
export const GET = withAuth(async ({ user }) => {
  const settings = await getSettings(user.id);
  const [summary, recent] = await Promise.all([
    getUsageSummary(user.id, user.timezone, settings.monthlyBudgetUsd),
    prisma.aiRequest.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 40,
      select: {
        id: true,
        feature: true,
        model: true,
        inputTokens: true,
        outputTokens: true,
        cacheReadTokens: true,
        estimatedCostUsd: true,
        latencyMs: true,
        success: true,
        errorMessage: true,
        createdAt: true,
      },
    }),
  ]);

  return ok({ summary, recent });
});
