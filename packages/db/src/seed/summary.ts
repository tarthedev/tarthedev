import { createHash } from "node:crypto";
import { DEMO_TABLE_ORDER, type DemoData, type DemoTableName } from "./generate";
import { divRoundHalfUp } from "./math";
import { localDay, mondayOf } from "./time";

/**
 * Counts, money totals and distribution checks for a demo data set. Used by
 * the seed CLI's report and by the determinism tests.
 */

/** Ladder levels from docs/02 section 4, for checking the demo spread only. */
export const DEMO_LADDER = [
  { level: "starter", minCents: Number.NEGATIVE_INFINITY },
  { level: "bronze", minCents: 300_000 },
  { level: "silver", minCents: 450_000 },
  { level: "gold", minCents: 600_000 },
  { level: "platinum", minCents: 800_000 },
] as const;
export type DemoLadderLevel = (typeof DEMO_LADDER)[number]["level"];

export interface DemoSummary {
  counts: Record<DemoTableName, number>;
  totals: {
    invoiceSubtotalCents: number;
    invoiceDiscountCents: number;
    invoiceTaxCents: number;
    invoiceTotalCents: number;
    openBalanceCents: number;
    paymentsCents: number;
    paymentFeesCents: number;
    jobCostsCents: number;
  };
  /** Mean total of non-zero HVAC service and plumbing invoices (callbacks have none). */
  averageServiceTicketCents: number;
  /** Share of customers with at least one membership, in basis points. */
  membershipShareBps: number;
  openInvoices: number;
  /** Tech-weeks per ladder level (weeks with at least one credited job). */
  ladderWeeks: Record<DemoLadderLevel, number>;
  /** sha256 of the whole data set; equal for equal seeds and options. */
  fingerprint: string;
}

export function summarizeDemoData(data: DemoData): DemoSummary {
  const counts = Object.fromEntries(
    DEMO_TABLE_ORDER.map((name) => [name, data[name].length]),
  ) as Record<DemoTableName, number>;

  const sumOf = <T>(rows: readonly T[], pick: (row: T) => number | null | undefined) =>
    rows.reduce((acc, row) => acc + (pick(row) ?? 0), 0);

  const buCode = new Map(data.businessUnits.map((b) => [b.id, b.code]));
  const serviceTickets = data.invoices.filter((inv) => {
    const code = inv.businessUnitId ? buCode.get(inv.businessUnitId) : undefined;
    return (
      (code === "hvac_service" || code === "plumbing") && inv.jobId && (inv.totalCents ?? 0) > 0
    );
  });
  const ticketSum = sumOf(serviceTickets, (i) => i.totalCents);

  const customersWithMembership = new Set(
    data.memberships.map(
      (m) => data.locations.find((l) => l.id === m.locationId)?.customerId ?? "",
    ),
  );

  return {
    counts,
    totals: {
      invoiceSubtotalCents: sumOf(data.invoices, (i) => i.subtotalCents),
      invoiceDiscountCents: sumOf(data.invoices, (i) => i.discountCents),
      invoiceTaxCents: sumOf(data.invoices, (i) => i.taxCents),
      invoiceTotalCents: sumOf(data.invoices, (i) => i.totalCents),
      openBalanceCents: sumOf(data.invoices, (i) => i.balanceCents),
      paymentsCents: sumOf(data.payments, (p) => p.amountCents),
      paymentFeesCents: sumOf(data.payments, (p) => p.feeCents),
      jobCostsCents: sumOf(data.jobCosts, (c) => c.amountCents),
    },
    averageServiceTicketCents: serviceTickets.length
      ? divRoundHalfUp(ticketSum, serviceTickets.length)
      : 0,
    membershipShareBps: divRoundHalfUp(
      customersWithMembership.size * 10_000,
      Math.max(1, data.customers.length),
    ),
    openInvoices: data.invoices.filter((i) => i.status === "open").length,
    ladderWeeks: ladderSpread(data),
    fingerprint: createHash("sha256").update(JSON.stringify(data)).digest("hex"),
  };
}

/**
 * Weekly credited GP per tech, following docs/02 section 3 closely enough to
 * check the demo spread: GP = sale (subtotal - discount) - job costs; split by
 * clocked time among techs; replacement installs go 100% to the selling tech
 * (none when an owner or manager sold it); callbacks are excluded; credited in
 * the week the job finished. The real engine lives in packages/core.
 */
export function weeklyTechGp(data: DemoData): Map<string, Map<string, number>> {
  const techs = new Set(data.users.filter((u) => u.role === "tech").map((u) => u.id));
  const sale = new Map<string, number>();
  for (const inv of data.invoices) {
    if (!inv.jobId) continue;
    const amount = (inv.subtotalCents ?? 0) - (inv.discountCents ?? 0);
    sale.set(inv.jobId, (sale.get(inv.jobId) ?? 0) + amount);
  }
  const cost = new Map<string, number>();
  for (const c of data.jobCosts) cost.set(c.jobId, (cost.get(c.jobId) ?? 0) + c.amountCents);
  const time = new Map<string, Map<string, number>>();
  for (const t of data.timeEntries) {
    if (t.kind !== "job" || !t.jobId || !t.endedAt || !techs.has(t.userId)) continue;
    const seconds = Math.round((t.endedAt.getTime() - t.startedAt.getTime()) / 1000);
    const perJob = time.get(t.jobId) ?? new Map<string, number>();
    perJob.set(t.userId, (perJob.get(t.userId) ?? 0) + seconds);
    time.set(t.jobId, perJob);
  }

  const weeks = new Map<string, Map<string, number>>();
  const credit = (userId: string, week: string, cents: number) => {
    const perUser = weeks.get(userId) ?? new Map<string, number>();
    perUser.set(week, (perUser.get(week) ?? 0) + cents);
    weeks.set(userId, perUser);
  };
  for (const job of data.jobs) {
    if (job.status !== "done" || !job.finishedAt || job.callbackOfJobId) continue;
    const gp = (sale.get(job.id) ?? 0) - (cost.get(job.id) ?? 0);
    const week = mondayOf(localDay(job.finishedAt));
    if (job.soldByUserId) {
      if (techs.has(job.soldByUserId)) credit(job.soldByUserId, week, gp);
      continue;
    }
    const perJob = time.get(job.id);
    if (!perJob) continue;
    const totalSeconds = [...perJob.values()].reduce((a, b) => a + b, 0);
    for (const [userId, seconds] of perJob) {
      const share = divRoundHalfUp(Math.abs(gp) * seconds, totalSeconds);
      credit(userId, week, gp < 0 ? -share : share);
    }
  }
  return weeks;
}

export function ladderLevel(weekGpCents: number): DemoLadderLevel {
  let level: DemoLadderLevel = "starter";
  for (const step of DEMO_LADDER) if (weekGpCents >= step.minCents) level = step.level;
  return level;
}

function ladderSpread(data: DemoData): Record<DemoLadderLevel, number> {
  const spread: Record<DemoLadderLevel, number> = {
    starter: 0,
    bronze: 0,
    silver: 0,
    gold: 0,
    platinum: 0,
  };
  for (const perUser of weeklyTechGp(data).values()) {
    for (const gp of perUser.values()) spread[ladderLevel(gp)]++;
  }
  return spread;
}
