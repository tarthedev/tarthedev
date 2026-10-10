import { type EquipmentKind, equipment } from "@dwrg/db";
import { equipmentMapping } from "../mappings/equipment";
import { EQUIPMENT_KIND_NAMES, EQUIPMENT_STATUS_NAMES, lookupValue } from "../mappings/values";
import type { RowReader } from "../reader";
import { yearOfLocalDate } from "../time";
import { defineHandler } from "./types";

type EquipmentField = keyof typeof equipmentMapping.fields;

export interface EquipmentRow {
  stId: string;
  locationStId: string;
  kind: EquipmentKind;
  brand: string | null | undefined;
  model: string | null | undefined;
  serial: string | null | undefined;
  installYear: number | null | undefined;
  warrantyEnd: string | null | undefined;
  /** false = no longer in service (soft-deleted here). */
  active: boolean | null | undefined;
  removedAt: Date | null | undefined;
  notes: string | null | undefined;
}

/**
 * Installed equipment at a location. Inactive equipment (replaced or
 * removed) is soft-deleted, dated by Removed On, or by the first import that
 * saw it inactive. Unknown equipment types import as "other" with the
 * ServiceTitan type kept in the notes.
 */
export const equipmentHandler = defineHandler({
  mapping: equipmentMapping,

  parse(r): EquipmentRow {
    const typeText = r.requiredText("equipmentType");
    const known = lookupValue(EQUIPMENT_KIND_NAMES, typeText);
    const notes = r.text("notes");
    const typeNote = typeText !== "" && known === null ? `ServiceTitan type: ${typeText}` : null;
    const installYear = r.int("installYear", 1900, 2100);
    const installDate = r.date("installDate");
    const status = r.choice("status", EQUIPMENT_STATUS_NAMES);
    return {
      stId: r.requiredId("equipmentId"),
      locationStId: r.requiredId("locationId"),
      kind: known ?? "other",
      brand: r.text("brand"),
      model: r.text("model"),
      serial: r.text("serial"),
      installYear: pickInstallYear(r, installYear, installDate),
      warrantyEnd: r.date("warrantyEnd"),
      active: status === undefined || status === null ? status : status === "active",
      removedAt: r.instant("removedOn"),
      notes: typeNote ? [typeNote, notes].filter(Boolean).join("\n") : notes,
    };
  },

  stIdOf: (row) => row.stId,

  claims: (row) => [
    { key: `equipment:${row.stId}`, label: `Equipment ${row.stId}`, details: { ...row } },
  ],

  businessUnits: () => [],

  async load(lookups, rows) {
    await lookups.loadLocations(rows.map((row) => row.locationStId));
    await lookups.loadEquipment(rows.map((row) => row.stId));
  },

  check(lookups, row, column) {
    lookups.location(row.locationStId, column("locationId"));
  },

  async importGroup(scope, rows, column) {
    const [parsed] = rows;
    if (!parsed) return [];
    const row = parsed.value;
    const { lookups } = scope;
    const location = lookups.location(row.locationStId, column("locationId"));
    const existing = lookups.equipment.get(row.stId);

    let deletedAt: Date | null | undefined;
    if (row.active === true) deletedAt = null;
    else if (row.active === false) {
      deletedAt = row.removedAt ?? existing?.deletedAt ?? scope.ctx.startedAt;
    }

    const { active: _active, removedAt: _removedAt, locationStId: _location, ...fields } = row;
    const { id, result } = await scope.upsert(equipment, equipment.stId, row.stId, {
      ...fields,
      locationId: location.id,
      ...(deletedAt === undefined ? {} : { deletedAt }),
    });
    scope.onCommit(() =>
      lookups.equipment.set(row.stId, {
        id,
        deletedAt: deletedAt === undefined ? (existing?.deletedAt ?? null) : deletedAt,
      }),
    );
    return [
      {
        rowNumber: parsed.rowNumber,
        result,
        stId: row.stId,
        targetTable: "equipment",
        targetId: id,
        error: null,
      },
    ];
  },
});

/** Install Year when given, else the year of Install Date; null when both are blank. */
function pickInstallYear(
  r: RowReader<EquipmentField>,
  year: number | null | undefined,
  date: string | null | undefined,
): number | null | undefined {
  if (typeof year === "number") return year;
  if (typeof date === "string") {
    const fromDate = yearOfLocalDate(date);
    if (fromDate < 1900 || fromDate > 2100) {
      r.fail("installDate", `${r.label("installDate")}: ${fromDate} is not a likely install year.`);
    }
    return fromDate;
  }
  if (year === null || date === null) return null;
  return undefined;
}
