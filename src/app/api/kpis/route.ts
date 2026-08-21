import { z } from "zod";

import { prisma } from "@/lib/db";
import { fail, ok, parseJson, withAuth } from "@/lib/http/api";
import { normalizeKey } from "@/lib/kpi/normalize";

export const GET = withAuth(async ({ user }) => {
  const kpis = await prisma.kpiDefinition.findMany({
    where: { userId: user.id },
    orderBy: [{ active: "desc" }, { sortOrder: "asc" }, { displayName: "asc" }],
  });
  return ok({ kpis });
});

const CreateSchema = z.object({
  key: z.string().trim().max(60).optional(),
  displayName: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  category: z.string().trim().max(60).optional(),
  unitType: z.enum(["COUNT", "CURRENCY", "PERCENT", "RATIO"]).default("COUNT"),
  aggregation: z.enum(["LATEST", "SUM"]).default("LATEST"),
  weight: z.number().positive().max(100).default(1),
  aliases: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
});

/** POST /api/kpis — the KPI list is data, never hard-coded. */
export const POST = withAuth(async ({ user, request }) => {
  const body = await parseJson(request, CreateSchema);
  const key = normalizeKey(body.key || body.displayName);
  if (!key) {
    return fail(400, {
      error: "That name does not produce a valid KPI key.",
      detail: "Use letters or numbers, for example \"Internet\" or \"New Lines\".",
      fields: { displayName: "Cannot derive a key from this name." },
    });
  }

  const duplicate = await prisma.kpiDefinition.findUnique({
    where: { userId_key: { userId: user.id, key } },
    select: { id: true },
  });
  if (duplicate) {
    return fail(409, { error: `A KPI with the key "${key}" already exists.`, fields: { key: "Already in use." } });
  }

  const maxSort = await prisma.kpiDefinition.aggregate({ where: { userId: user.id }, _max: { sortOrder: true } });
  const kpi = await prisma.kpiDefinition.create({
    data: {
      userId: user.id,
      key,
      displayName: body.displayName,
      description: body.description ?? null,
      category: body.category ?? null,
      unitType: body.unitType,
      aggregation: body.aggregation,
      weight: body.weight,
      aliases: body.aliases,
      sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
    },
  });
  return ok({ kpi }, { status: 201 });
});
