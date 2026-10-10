import { type PricebookKind, pricebookItems } from "@dwrg/db";
import { RowError } from "../errors";
import type { Lookups } from "../lookups";
import { pricebookMapping } from "../mappings/pricebook";
import { PRICEBOOK_KIND_NAMES } from "../mappings/values";
import { type ColumnLabel, defineHandler } from "./types";

type PricebookField = keyof typeof pricebookMapping.fields;

export interface PricebookRow {
  stId: string;
  code: string;
  name: string;
  kind: PricebookKind;
  category: string;
  description: string | null | undefined;
  priceCents: number;
  memberPriceCents: number | null | undefined;
  costCents: number | undefined;
  estMinutes: number | null | undefined;
  taxable: boolean | undefined;
  active: boolean | undefined;
}

/**
 * Pricebook items keyed on ServiceTitan's item ID. Spiffs and combo tags are
 * ours (docs/02) and never come from an import, so re-imports leave them alone.
 */
export const pricebookHandler = defineHandler({
  mapping: pricebookMapping,

  parse(r): PricebookRow {
    const priceCents = r.requiredMoney("price");
    const memberPriceCents = r.money("memberPrice");
    const cost = r.money("cost");
    for (const [field, value] of [
      ["price", priceCents],
      ["memberPrice", memberPriceCents],
      ["cost", cost],
    ] as const) {
      if (typeof value === "number" && value < 0) r.fail(field, `${r.label(field)} is negative.`);
    }
    const minutes = r.int("minutes", 0);
    const hours = r.hoursAsMinutes("hours");
    const taxable = r.bool("taxable");
    const active = r.bool("active");
    const category = r.text("category");
    return {
      stId: r.requiredId("itemId"),
      code: r.requiredText("code"),
      name: r.requiredText("name"),
      kind: r.requiredChoice("itemType", PRICEBOOK_KIND_NAMES, "service"),
      category: category ?? "Uncategorized",
      description: r.text("description"),
      priceCents,
      memberPriceCents,
      // Blank cells in NOT NULL columns take the column's usual default.
      costCents: cost === null ? 0 : cost,
      estMinutes: minutes !== undefined && r.cell("minutes") !== "" ? minutes : hours,
      taxable: taxable === null ? false : taxable,
      active: active === null ? true : active,
    };
  },

  stIdOf: (row) => row.stId,

  claims: (row) => [
    { key: `pricebook_items:${row.stId}`, label: `Item ${row.stId}`, details: { ...row } },
    { key: `pricebook-code:${row.code}`, label: `Code ${row.code}`, details: { stId: row.stId } },
  ],

  businessUnits: () => [],

  async load(lookups) {
    await lookups.loadPricebook();
  },

  check: (lookups, row, column) => checkCode(lookups, row, column),

  async importGroup(scope, rows, column) {
    const [parsed] = rows;
    if (!parsed) return [];
    const row = parsed.value;
    checkCode(scope.lookups, row, column);
    const { id, result } = await scope.upsert(pricebookItems, pricebookItems.stId, row.stId, {
      stId: row.stId,
      kind: row.kind,
      code: row.code,
      name: row.name,
      category: row.category,
      description: row.description,
      priceCents: row.priceCents,
      memberPriceCents: row.memberPriceCents,
      costCents: row.costCents,
      estMinutes: row.estMinutes,
      taxable: row.taxable,
      active: row.active,
    });
    scope.onCommit(() =>
      scope.lookups.pricebookByCode.set(row.code, { id, stId: row.stId, kind: row.kind }),
    );
    return [
      {
        rowNumber: parsed.rowNumber,
        result,
        stId: row.stId,
        targetTable: "pricebook_items",
        targetId: id,
        error: null,
      },
    ];
  },
});

function checkCode(lookups: Lookups, row: PricebookRow, column: ColumnLabel<PricebookField>): void {
  const holder = lookups.pricebookByCode.get(row.code);
  if (holder && holder.stId !== row.stId) {
    throw new RowError(
      holder.stId
        ? `Code ${row.code} already belongs to pricebook item ${holder.stId}.`
        : `Code ${row.code} already belongs to an item created in this system.`,
      undefined,
      column("code"),
    );
  }
}
