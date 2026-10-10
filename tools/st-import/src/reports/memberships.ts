import { daysBetween } from "@dwrg/core";
import { type MembershipStatus, membershipPlans, memberships } from "@dwrg/db";
import { rowResult } from "../context";
import { membershipsMapping } from "../mappings/memberships";
import { MEMBERSHIP_STATUS_NAMES } from "../mappings/values";
import { defineHandler } from "./types";

export interface MembershipRow {
  stId: string;
  locationStId: string;
  planStId: string | null | undefined;
  planName: string;
  status: MembershipStatus;
  startDate: string;
  endDate: string;
  visitsRemaining: number;
  priceCents: number;
  autoRenew: boolean | undefined;
  /** Technician ID or exact name of who sold it. */
  soldBy: string | null | undefined;
  canceledAt: Date | null | undefined;
}

/** Whole months from `start` to `end` (at least 1), for a plan created from a membership row. */
function termMonths(start: string, end: string): number {
  const [sy, sm] = start.split("-").map(Number) as [number, number];
  const [ey, em] = end.split("-").map(Number) as [number, number];
  return Math.max(1, (ey - sy) * 12 + (em - sm));
}

/**
 * Membership terms at a location. Plans are matched by Membership Type ID,
 * else by name. A plan we don't have yet is created inactive with the row's
 * price, flagged in its notes for the office to set visits and the member
 * discount before it's sold here.
 */
export const membershipsHandler = defineHandler({
  mapping: membershipsMapping,

  parse(r): MembershipRow {
    const startDate = r.requiredDate("startDate");
    const endDate = r.requiredDate("endDate");
    if (r.ok && daysBetween(startDate, endDate) <= 0) {
      r.fail("endDate", `${r.label("endDate")} must be after ${r.label("startDate")}.`);
    }
    const priceCents = r.requiredMoney("price");
    if (priceCents < 0) r.fail("price", `${r.label("price")} is negative.`);
    const autoRenew = r.bool("autoRenew");
    return {
      stId: r.requiredId("membershipId"),
      locationStId: r.requiredId("locationId"),
      planStId: r.id("planId"),
      planName: r.requiredText("planName"),
      status: r.requiredChoice("status", MEMBERSHIP_STATUS_NAMES, "active"),
      startDate,
      endDate,
      visitsRemaining: r.requiredInt("visitsRemaining", 0),
      priceCents,
      autoRenew: autoRenew === null ? false : autoRenew,
      soldBy: r.text("soldBy"),
      canceledAt: r.instant("canceledOn"),
    };
  },

  stIdOf: (row) => row.stId,

  claims: (row) => [
    { key: `memberships:${row.stId}`, label: `Membership ${row.stId}`, details: { ...row } },
  ],

  businessUnits: () => [],

  async load(lookups, rows) {
    await lookups.loadLocations(rows.map((row) => row.locationStId));
    await lookups.loadPlans();
    await lookups.loadPeople();
  },

  check(lookups, row, column) {
    lookups.location(row.locationStId, column("locationId"));
    if (row.soldBy) lookups.person(row.soldBy, column("soldBy"));
  },

  async importGroup(scope, rows, column) {
    const [parsed] = rows;
    if (!parsed) return [];
    const row = parsed.value;
    const { lookups } = scope;
    const location = lookups.location(row.locationStId, column("locationId"));
    const soldByUserId =
      row.soldBy === undefined || row.soldBy === null
        ? row.soldBy
        : lookups.person(row.soldBy, column("soldBy"));

    let planId = lookups.plan(row.planStId ?? null, row.planName);
    let planCreated = false;
    if (!planId) {
      const plan = await scope.insert(membershipPlans, {
        stId: row.planStId ?? null,
        name: row.planName,
        priceCents: row.priceCents,
        termMonths: termMonths(row.startDate, row.endDate),
        active: false,
        notes:
          "Created by a ServiceTitan memberships import. Set the visits, visit kinds and member discount, then mark it active.",
      });
      planId = plan.id;
      planCreated = true;
      const id = plan.id;
      scope.onCommit(() => lookups.rememberPlan(id, row.planStId ?? null, row.planName));
    }

    const { id, result } = await scope.upsert(memberships, memberships.stId, row.stId, {
      stId: row.stId,
      locationId: location.id,
      planId,
      status: row.status,
      startDate: row.startDate,
      endDate: row.endDate,
      visitsRemaining: row.visitsRemaining,
      priceCents: row.priceCents,
      autoRenew: row.autoRenew,
      ...(soldByUserId === undefined ? {} : { soldByUserId }),
      ...(row.canceledAt === undefined ? {} : { canceledAt: row.canceledAt }),
    });
    return [
      {
        rowNumber: parsed.rowNumber,
        result: rowResult(result, [planCreated ? "inserted" : "unchanged"]),
        stId: row.stId,
        targetTable: "memberships",
        targetId: id,
        error: null,
      },
    ];
  },
});
