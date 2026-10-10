import { type Database, pricebookItems } from "@dwrg/db";
import type { PricebookListResponse, PricebookQuery } from "@dwrg/shared";
import { and, asc, count, eq, ilike, isNull, or, type SQL, sql } from "drizzle-orm";
import { containsPattern, searchWords } from "./search";

/** The pricebook, filtered and paged. Deleted items never show; inactive ones only on request. */
export async function listPricebook(
  db: Database,
  query: PricebookQuery,
): Promise<PricebookListResponse> {
  const conditions: SQL[] = [isNull(pricebookItems.deletedAt)];
  if (!query.includeInactive) conditions.push(eq(pricebookItems.active, true));
  if (query.kind) conditions.push(eq(pricebookItems.kind, query.kind));
  if (query.category)
    conditions.push(sql`lower(${pricebookItems.category}) = lower(${query.category})`);
  for (const word of query.q ? searchWords(query.q) : []) {
    const p = containsPattern(word);
    conditions.push(
      or(
        ilike(pricebookItems.code, p),
        ilike(pricebookItems.name, p),
        ilike(pricebookItems.description, p),
      ) as SQL,
    );
  }
  const where = and(...conditions);

  const [counted] = await db.select({ total: count() }).from(pricebookItems).where(where);
  const rows = await db
    .select({
      id: pricebookItems.id,
      stId: pricebookItems.stId,
      kind: pricebookItems.kind,
      code: pricebookItems.code,
      name: pricebookItems.name,
      description: pricebookItems.description,
      category: pricebookItems.category,
      priceCents: pricebookItems.priceCents,
      memberPriceCents: pricebookItems.memberPriceCents,
      costCents: pricebookItems.costCents,
      estMinutes: pricebookItems.estMinutes,
      taxable: pricebookItems.taxable,
      spiffCents: pricebookItems.spiffCents,
      comboTags: pricebookItems.comboTags,
      active: pricebookItems.active,
    })
    .from(pricebookItems)
    .where(where)
    .orderBy(asc(pricebookItems.category), asc(pricebookItems.name), asc(pricebookItems.code))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  return { items: rows, page: query.page, pageSize: query.pageSize, total: counted?.total ?? 0 };
}
