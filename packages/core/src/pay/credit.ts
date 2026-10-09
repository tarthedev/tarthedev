/**
 * Who gets credit for a job's gross profit (docs/02-commission-plan.md section 3).
 *
 * - Default: split among the techs on the job in proportion to clocked time.
 * - A manager can set a different split (basis points adding to 100%) with a reason.
 * - Replacement sold by a tech: 100% to the sold-by tech; installers' time is labor.
 * - Replacement sold by an owner or manager: no GP credit; the lead-source tech gets
 *   the lead bonus instead (see spiffs).
 * - Callback and warranty visits: no credit; they are excluded from week scores.
 */

import { assertNonNegativeInt, assertText } from "../internal/int";
import {
  assertCents,
  BPS_SCALE,
  type Bps,
  type Cents,
  formatBps,
  formatCents,
  formatMinutes,
  prorate,
} from "../money";

export type ClockedShare = { userId: string; minutes: number };
export type ManualShare = { userId: string; shareBps: Bps };

export type GpCredit = {
  userId: string;
  /** The tech's share of the job, in basis points (for display and `job_gp_credits.share_bps`). */
  shareBps: Bps;
  creditedGpCents: Cents;
  explanation: string;
};

export type CreditOptions = {
  /** Required when the split is manual: why the manager changed it (shown to techs, audited). */
  manualReason?: string;
};

function isClocked(entry: ClockedShare | ManualShare): entry is ClockedShare {
  return "minutes" in entry;
}

/**
 * Splits a job's GP among its techs with exact cents (largest remainder).
 * Pass clocked minutes for the default split, or `shareBps` (adding to 10_000) with
 * `options.manualReason` for a manager's split. Repeated users in a clocked split are merged.
 */
export function creditGrossProfit(
  gpCents: Cents,
  techs: readonly ClockedShare[] | readonly ManualShare[],
  options: CreditOptions = {},
): GpCredit[] {
  assertCents(gpCents, "gpCents");
  if (techs.length === 0) {
    throw new RangeError("A job needs at least one tech to credit");
  }
  const entries: readonly (ClockedShare | ManualShare)[] = techs;
  const clocked = entries.every(isClocked);
  const manual = entries.every((entry) => !isClocked(entry));
  if (!clocked && !manual) {
    throw new TypeError("Use either clocked minutes or manual shares for every tech, not a mix");
  }

  if (clocked) {
    const merged = new Map<string, number>();
    for (const [index, entry] of (entries as readonly ClockedShare[]).entries()) {
      assertText(entry.userId, `techs[${index}].userId`);
      assertNonNegativeInt(entry.minutes, `techs[${index}].minutes`);
      merged.set(entry.userId, (merged.get(entry.userId) ?? 0) + entry.minutes);
    }
    const userIds = [...merged.keys()];
    const minutes = [...merged.values()];
    const totalMinutes = minutes.reduce((sum, value) => sum + value, 0);
    if (totalMinutes === 0) {
      throw new RangeError("No clocked time on this job; a manager must set the split by hand");
    }
    const credited = prorate(gpCents, minutes);
    const shares = prorate(BPS_SCALE, minutes);
    return userIds.map((userId, index) => {
      const share = shares[index] ?? 0;
      const credit = credited[index] ?? 0;
      return {
        userId,
        shareBps: share,
        creditedGpCents: credit,
        explanation:
          userIds.length === 1
            ? `You were the only tech on this job, so you get all ${formatCents(gpCents)} of its gross profit.`
            : `You clocked ${formatMinutes(minutes[index] ?? 0)} of the ${formatMinutes(totalMinutes)} on this job (${formatBps(share)}), so you get ${formatCents(credit)} of its ${formatCents(gpCents)} gross profit.`,
      };
    });
  }

  const reason = options.manualReason;
  if (reason === undefined || reason.trim() === "") {
    throw new TypeError("A manual split needs a reason");
  }
  const seen = new Set<string>();
  const shares = (entries as readonly ManualShare[]).map((entry, index) => {
    assertText(entry.userId, `techs[${index}].userId`);
    assertNonNegativeInt(entry.shareBps, `techs[${index}].shareBps`);
    if (seen.has(entry.userId)) {
      throw new RangeError(`Tech ${entry.userId} appears twice in the manual split`);
    }
    seen.add(entry.userId);
    return entry.shareBps;
  });
  const total = shares.reduce((sum, value) => sum + value, 0);
  if (total !== BPS_SCALE) {
    throw new RangeError(`A manual split must add up to 100%, got ${formatBps(total)}`);
  }
  const credited = prorate(gpCents, shares);
  return (entries as readonly ManualShare[]).map((entry, index) => {
    const credit = credited[index] ?? 0;
    return {
      userId: entry.userId,
      shareBps: entry.shareBps,
      creditedGpCents: credit,
      explanation: `A manager set your share of this job to ${formatBps(entry.shareBps)} (${reason.trim()}), so you get ${formatCents(credit)} of its ${formatCents(gpCents)} gross profit.`,
    };
  });
}

export type JobSale =
  | { kind: "service" }
  | { kind: "replacement_sold_by_tech"; soldByUserId: string }
  | { kind: "replacement_sold_by_owner_or_manager"; leadSourceUserId: string | null };

export type JobCreditInput = {
  jobId: string;
  gpCents: Cents;
  /** Linked to an earlier job as a callback or warranty visit. */
  isCallback?: boolean;
  /** Defaults to a service job (split by clocked time). */
  sale?: JobSale;
  /** Clocked minutes of the techs on the job (installers are labor, not credit). */
  techs: readonly ClockedShare[];
  /** A manager's split, replacing the clocked split on a service job. */
  manualSplit?: { shares: readonly ManualShare[]; reason: string };
};

export type JobCreditResult = {
  jobId: string;
  /** False for callbacks: the visit is excluded from every week score. */
  countsTowardWeekScore: boolean;
  credits: GpCredit[];
  /** The tech owed the lead bonus (owner/manager-sold replacement), if any. */
  leadBonusUserId: string | null;
  explanation: string;
};

/** Applies the crediting rules of section 3 to one job. */
export function creditJob(input: JobCreditInput): JobCreditResult {
  assertText(input.jobId, "jobId");
  const gpCents = assertCents(input.gpCents, "gpCents");
  const sale = input.sale ?? { kind: "service" };

  if (input.isCallback) {
    return {
      jobId: input.jobId,
      countsTowardWeekScore: false,
      credits: [],
      leadBonusUserId: null,
      explanation:
        "This is a callback or warranty visit, so it doesn't count toward anyone's week score. The tech who runs it is paid hourly.",
    };
  }

  if (sale.kind === "replacement_sold_by_owner_or_manager") {
    if (input.manualSplit) {
      throw new RangeError("An owner- or manager-sold replacement has no GP credit to split");
    }
    return {
      jobId: input.jobId,
      countsTowardWeekScore: false,
      credits: [],
      leadBonusUserId: sale.leadSourceUserId,
      explanation:
        sale.leadSourceUserId === null
          ? "An owner or manager sold this replacement, so no tech gets gross profit credit."
          : "An owner or manager sold this replacement, so no tech gets gross profit credit. The tech who turned over the lead gets the lead bonus when the customer pays in full.",
    };
  }

  if (sale.kind === "replacement_sold_by_tech") {
    assertText(sale.soldByUserId, "soldByUserId");
    if (input.manualSplit) {
      throw new RangeError(
        "A tech-sold replacement credits 100% to the sold-by tech; a manual split isn't allowed",
      );
    }
    return {
      jobId: input.jobId,
      countsTowardWeekScore: true,
      credits: [
        {
          userId: sale.soldByUserId,
          shareBps: BPS_SCALE,
          creditedGpCents: gpCents,
          explanation: `You sold this replacement, so you get 100% of the install's ${formatCents(gpCents)} gross profit in the week the install was finished. Installers' time is labor in that gross profit.`,
        },
      ],
      leadBonusUserId: null,
      explanation:
        "Replacement sold by a tech: 100% of the install's gross profit goes to the sold-by tech.",
    };
  }

  const credits = input.manualSplit
    ? creditGrossProfit(gpCents, input.manualSplit.shares, {
        manualReason: input.manualSplit.reason,
      })
    : creditGrossProfit(gpCents, input.techs);
  return {
    jobId: input.jobId,
    countsTowardWeekScore: true,
    credits,
    leadBonusUserId: null,
    explanation: input.manualSplit
      ? "Gross profit split by a manager's override."
      : "Gross profit split by each tech's clocked time on the job.",
  };
}
