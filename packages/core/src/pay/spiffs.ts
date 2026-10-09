/**
 * Tech spiffs and combo bonuses (docs/02-commission-plan.md section 7).
 *
 * - Item spiffs come from rules matched by pricebook item or category, paid per unit, and are
 *   credited to the techs on the invoice using the same split as GP.
 * - The membership spiff is an item rule of kind "membership" (paid when the membership is paid).
 * - Combo bonuses are paid in addition to item spiffs, once per invoice per combo, when every
 *   item in the combo is on the same invoice.
 * - Review spiff: 5 stars on Google, names the tech, within 30 days of the visit, verified, one per job.
 * - Lead bonus: the lead-source tech on an owner- or manager-sold replacement, when paid in full.
 *
 * Amounts always come from the rules passed in; the doc's starting values are exported as defaults.
 */

import { assertInt, assertNonNegativeInt, assertText } from "../internal/int";
import {
  BPS_SCALE,
  type Bps,
  type Cents,
  formatBps,
  formatCents,
  mulDivHalfUp,
  prorate,
  sumCents,
} from "../money";
import { daysBetween, type LocalDate } from "../time/weeks";
import { lineStatusFor, type PayLineStatus } from "./payability";

/** `spiff_rules.kind` values. */
export type SpiffRuleKind =
  | "item"
  | "combo"
  | "membership"
  | "review"
  | "lead"
  | "booked_sale"
  | "phone_membership"
  | "phone_renewal"
  | "booking_rate";

/** `pay_lines.kind` values that spiffs produce. */
export type SpiffPayLineKind = "spiff" | "combo" | "lead" | "booking" | "booking_rate";

export type InvoiceLine = {
  itemId: string;
  /** Pricebook category key, e.g. "uv_light" or "membership". */
  category?: string | null;
  /** Extra combo tags from the pricebook item. */
  tags?: readonly string[];
  /** Units sold. Negative for a returned or removed item. Must be whole for spiff items. */
  qty: number;
  name?: string;
};

export type ItemMatch = { itemId: string } | { category: string };

export type ItemSpiffRule = {
  kind: "item" | "membership";
  label: string;
  match: ItemMatch;
  /** Paid per unit. */
  amountCents: Cents;
};

export type ComboRule = {
  kind: "combo";
  label: string;
  /** Each requirement is a list of acceptable keys (item ID, category or tag); all requirements must be on the invoice. */
  requires: readonly (readonly string[])[];
  amountCents: Cents;
  /** Plain names of the requirements, for explanations. */
  requirementLabels?: readonly string[];
};

/** Category keys used by the default rules. Pricebook items carry these as category or tags. */
export const SPIFF_CATEGORY = Object.freeze({
  uvLight: "uv_light",
  airPurifier: "air_purifier",
  airScrubber: "air_scrubber",
  dehumidifier: "whole_home_dehumidifier",
  surgeProtector: "surge_protector",
  waterFilter: "water_filter",
  waterSoftener: "water_softener",
  leakShutoffValve: "leak_shutoff_valve",
  membership: "membership",
});

/** Starting item spiffs from the commission plan (section 7). */
export const DEFAULT_ITEM_SPIFF_RULES: readonly ItemSpiffRule[] = Object.freeze([
  {
    kind: "item",
    label: "UV light",
    match: { category: SPIFF_CATEGORY.uvLight },
    amountCents: 5_000,
  },
  {
    kind: "item",
    label: "Air purifier",
    match: { category: SPIFF_CATEGORY.airPurifier },
    amountCents: 5_000,
  },
  {
    kind: "item",
    label: "Air scrubber",
    match: { category: SPIFF_CATEGORY.airScrubber },
    amountCents: 5_000,
  },
  {
    kind: "item",
    label: "Whole-home dehumidifier",
    match: { category: SPIFF_CATEGORY.dehumidifier },
    amountCents: 7_500,
  },
  {
    kind: "item",
    label: "Surge protector",
    match: { category: SPIFF_CATEGORY.surgeProtector },
    amountCents: 2_000,
  },
  {
    kind: "item",
    label: "Whole-home water filter",
    match: { category: SPIFF_CATEGORY.waterFilter },
    amountCents: 7_500,
  },
  {
    kind: "item",
    label: "Water softener",
    match: { category: SPIFF_CATEGORY.waterSoftener },
    amountCents: 7_500,
  },
  {
    kind: "item",
    label: "Leak-detection shut-off valve",
    match: { category: SPIFF_CATEGORY.leakShutoffValve },
    amountCents: 4_000,
  },
  {
    kind: "membership",
    label: "Membership sold",
    match: { category: SPIFF_CATEGORY.membership },
    amountCents: 4_000,
  },
] satisfies ItemSpiffRule[]);

/** Starting combo bonuses from the commission plan (section 7). */
export const DEFAULT_COMBO_RULES: readonly ComboRule[] = Object.freeze([
  {
    kind: "combo",
    label: "Clean Air Combo",
    requires: [
      [SPIFF_CATEGORY.uvLight],
      [SPIFF_CATEGORY.surgeProtector],
      [SPIFF_CATEGORY.membership],
    ],
    requirementLabels: ["UV light", "surge protector", "membership"],
    amountCents: 7_500,
  },
  {
    kind: "combo",
    label: "Water Guard Combo",
    requires: [
      [SPIFF_CATEGORY.leakShutoffValve],
      [SPIFF_CATEGORY.waterFilter, SPIFF_CATEGORY.waterSoftener],
      [SPIFF_CATEGORY.membership],
    ],
    requirementLabels: ["leak shut-off valve", "water filter or softener", "membership"],
    amountCents: 7_500,
  },
] satisfies ComboRule[]);

export const DEFAULT_MEMBERSHIP_SPIFF_CENTS: Cents = 4_000;

export type SpiffShare = { userId: string; shareBps: Bps };

export type SpiffSplit = { userId: string; amountCents: Cents };

export type SpiffAward = {
  ruleKind: "item" | "membership" | "combo";
  payLineKind: "spiff" | "combo";
  label: string;
  quantity: number;
  unitCents: Cents;
  amountCents: Cents;
  splits: SpiffSplit[];
  explanation: string;
};

export type UserSpiffLine = {
  userId: string;
  ruleKind: SpiffAward["ruleKind"];
  payLineKind: SpiffAward["payLineKind"];
  label: string;
  amountCents: Cents;
  explanation: string;
};

export type InvoiceSpiffs = {
  invoiceId: string;
  awards: SpiffAward[];
  totalCents: Cents;
  /** Pay lines per tech, in share order. */
  byUser: { userId: string; totalCents: Cents; lines: UserSpiffLine[] }[];
};

export type InvoiceSpiffInput = {
  invoiceId: string;
  lines: readonly InvoiceLine[];
  /** The techs on the invoice, split the same way as GP (adding up to 100%). */
  shares: readonly SpiffShare[];
};

function validateShares(shares: readonly SpiffShare[]): void {
  if (shares.length === 0) {
    throw new RangeError("An invoice needs at least one tech to credit spiffs to");
  }
  const seen = new Set<string>();
  let total = 0;
  shares.forEach((share, index) => {
    assertText(share.userId, `shares[${index}].userId`);
    assertNonNegativeInt(share.shareBps, `shares[${index}].shareBps`);
    if (seen.has(share.userId)) {
      throw new RangeError(`Tech ${share.userId} appears twice in the spiff split`);
    }
    seen.add(share.userId);
    total += share.shareBps;
  });
  if (total !== BPS_SCALE) {
    throw new RangeError(`Spiff shares must add up to 100%, got ${formatBps(total)}`);
  }
}

function lineKeys(line: InvoiceLine): Set<string> {
  const keys = new Set<string>([line.itemId]);
  if (line.category) keys.add(line.category);
  for (const tag of line.tags ?? []) keys.add(tag);
  return keys;
}

function matchingItemRule(line: InvoiceLine, rules: readonly ItemSpiffRule[]): number | null {
  const byItem: number[] = [];
  const byCategory: number[] = [];
  rules.forEach((rule, index) => {
    if ("itemId" in rule.match && rule.match.itemId === line.itemId) byItem.push(index);
    else if ("category" in rule.match && line.category && rule.match.category === line.category) {
      byCategory.push(index);
    }
  });
  const chosen = byItem.length > 0 ? byItem : byCategory;
  if (chosen.length > 1) {
    throw new RangeError(
      `${chosen.length} spiff rules match item ${line.itemId} equally; fix the spiff settings`,
    );
  }
  return chosen[0] ?? null;
}

function splitAward(amountCents: Cents, shares: readonly SpiffShare[]): SpiffSplit[] {
  const parts = prorate(
    amountCents,
    shares.map((share) => share.shareBps),
  );
  return shares
    .map((share, index) => ({ userId: share.userId, amountCents: parts[index] ?? 0 }))
    .filter((split) => split.amountCents !== 0);
}

function shareNote(shares: readonly SpiffShare[], userId: string, amountCents: Cents): string {
  if (shares.length === 1) return "";
  const share = shares.find((candidate) => candidate.userId === userId);
  return ` Your ${formatBps(share?.shareBps ?? 0)} share (same split as gross profit): ${formatCents(amountCents)}.`;
}

/**
 * Item, membership and combo spiffs for one invoice, split among its techs.
 * Each combo pays at most once per invoice, in addition to the items' own spiffs.
 */
export function evaluateInvoiceSpiffs(
  input: InvoiceSpiffInput,
  rules: { items: readonly ItemSpiffRule[]; combos: readonly ComboRule[] } = {
    items: DEFAULT_ITEM_SPIFF_RULES,
    combos: DEFAULT_COMBO_RULES,
  },
): InvoiceSpiffs {
  assertText(input.invoiceId, "invoiceId");
  validateShares(input.shares);
  rules.items.forEach((rule, index) => {
    assertText(rule.label, `items[${index}].label`);
    assertNonNegativeInt(rule.amountCents, `items[${index}].amountCents`);
  });
  rules.combos.forEach((rule, index) => {
    assertText(rule.label, `combos[${index}].label`);
    assertNonNegativeInt(rule.amountCents, `combos[${index}].amountCents`);
    if (rule.requires.length === 0 || rule.requires.some((options) => options.length === 0)) {
      throw new RangeError(`combos[${index}] needs at least one item in every requirement`);
    }
  });

  const netQtyByRule = new Map<number, number>();
  input.lines.forEach((line, index) => {
    assertText(line.itemId, `lines[${index}].itemId`);
    if (typeof line.qty !== "number" || !Number.isFinite(line.qty)) {
      throw new RangeError(`lines[${index}].qty must be a number`);
    }
    const ruleIndex = matchingItemRule(line, rules.items);
    if (ruleIndex !== null) {
      assertInt(line.qty, `lines[${index}].qty (a spiff item)`);
      netQtyByRule.set(ruleIndex, (netQtyByRule.get(ruleIndex) ?? 0) + line.qty);
    }
  });

  const awards: SpiffAward[] = [];
  rules.items.forEach((rule, index) => {
    const quantity = netQtyByRule.get(index) ?? 0;
    if (quantity <= 0 || rule.amountCents === 0) return;
    const amountCents = mulDivHalfUp(quantity, rule.amountCents, 1);
    awards.push({
      ruleKind: rule.kind,
      payLineKind: "spiff",
      label: rule.label,
      quantity,
      unitCents: rule.amountCents,
      amountCents,
      splits: splitAward(amountCents, input.shares),
      explanation:
        quantity === 1
          ? `${rule.label} spiff: ${formatCents(amountCents)}.`
          : `${rule.label} spiff: ${quantity} × ${formatCents(rule.amountCents)} = ${formatCents(amountCents)}.`,
    });
  });

  for (const combo of rules.combos) {
    const complete = combo.requires.every((options) => {
      let net = 0;
      for (const line of input.lines) {
        const keys = lineKeys(line);
        if (options.some((key) => keys.has(key))) net += line.qty;
      }
      return net > 0;
    });
    if (!complete || combo.amountCents === 0) continue;
    const names =
      combo.requirementLabels?.join(" + ") ??
      combo.requires.map((options) => options.join(" or ")).join(" + ");
    awards.push({
      ruleKind: "combo",
      payLineKind: "combo",
      label: combo.label,
      quantity: 1,
      unitCents: combo.amountCents,
      amountCents: combo.amountCents,
      splits: splitAward(combo.amountCents, input.shares),
      explanation: `${combo.label} bonus: ${names} on one invoice = ${formatCents(combo.amountCents)}, on top of each item's own spiff (once per invoice).`,
    });
  }

  const byUser = input.shares.map((share) => {
    const lines: UserSpiffLine[] = [];
    for (const award of awards) {
      const split = award.splits.find((candidate) => candidate.userId === share.userId);
      if (!split) continue;
      lines.push({
        userId: share.userId,
        ruleKind: award.ruleKind,
        payLineKind: award.payLineKind,
        label: award.label,
        amountCents: split.amountCents,
        explanation: `Invoice ${input.invoiceId}: ${award.explanation}${shareNote(input.shares, share.userId, split.amountCents)}`,
      });
    }
    return {
      userId: share.userId,
      totalCents: sumCents(lines.map((line) => line.amountCents)),
      lines,
    };
  });

  return {
    invoiceId: input.invoiceId,
    awards,
    totalCents: sumCents(awards.map((award) => award.amountCents)),
    byUser,
  };
}

/** A single spiff decision: a line to create, or the reasons there isn't one. */
export type SpiffDecision =
  | {
      eligible: true;
      userId: string;
      ruleKind: SpiffRuleKind;
      payLineKind: SpiffPayLineKind;
      amountCents: Cents;
      status: Extract<PayLineStatus, "pending_payment" | "payable">;
      explanation: string;
    }
  | { eligible: false; reasons: string[]; explanation: string };

function notEligible(reasons: string[], lead: string): SpiffDecision {
  return { eligible: false, reasons, explanation: `${lead} ${reasons.join(" ")}`.trim() };
}

export type ReviewSpiffRule = {
  amountCents: Cents;
  minStars: number;
  windowDays: number;
  platform: string;
};

export const DEFAULT_REVIEW_SPIFF_RULE: ReviewSpiffRule = Object.freeze({
  amountCents: 2_000,
  minStars: 5,
  windowDays: 30,
  platform: "google",
});

export type ReviewInput = {
  jobId: string;
  /** The tech the review names. */
  techUserId: string;
  platform: string;
  stars: number;
  mentionsTechByName: boolean;
  visitOn: LocalDate;
  postedOn: LocalDate;
  /** When the office verified the review in the app, or null. */
  verifiedAt: string | null;
  /** Review spiffs already created for this job (one per job). */
  reviewSpiffsAlreadyOnJob: number;
};

/** Review spiff: 5 stars on Google, names the tech, within 30 days of the visit, verified, one per job. */
export function reviewSpiff(
  input: ReviewInput,
  rule: ReviewSpiffRule = DEFAULT_REVIEW_SPIFF_RULE,
): SpiffDecision {
  assertText(input.jobId, "jobId");
  assertText(input.techUserId, "techUserId");
  assertNonNegativeInt(rule.amountCents, "rule.amountCents");
  assertNonNegativeInt(input.reviewSpiffsAlreadyOnJob, "reviewSpiffsAlreadyOnJob");
  const reasons: string[] = [];
  if (input.platform.toLowerCase() !== rule.platform.toLowerCase()) {
    reasons.push(`It isn't a ${rule.platform} review.`);
  }
  if (input.stars < rule.minStars) {
    reasons.push(`It has ${input.stars} stars; it needs ${rule.minStars}.`);
  }
  if (!input.mentionsTechByName) {
    reasons.push("It doesn't name the tech.");
  }
  const days = daysBetween(input.visitOn, input.postedOn);
  if (days < 0) {
    reasons.push("It was posted before the visit.");
  } else if (days > rule.windowDays) {
    reasons.push(`It was posted ${days} days after the visit; the limit is ${rule.windowDays}.`);
  }
  if (input.verifiedAt === null) {
    reasons.push("The office hasn't verified it yet.");
  }
  if (input.reviewSpiffsAlreadyOnJob > 0) {
    reasons.push("This job already has a review spiff (one per job).");
  }
  if (reasons.length > 0) {
    return notEligible(reasons, "No review spiff:");
  }
  return {
    eligible: true,
    userId: input.techUserId,
    ruleKind: "review",
    payLineKind: "spiff",
    amountCents: rule.amountCents,
    status: "payable",
    explanation: `Job ${input.jobId}: verified ${rule.minStars}-star review naming you, posted ${days} days after the visit = ${formatCents(rule.amountCents)}.`,
  };
}

export const DEFAULT_LEAD_BONUS_CENTS: Cents = 15_000;

/**
 * Lead bonus: when an owner or manager sells a replacement, the tech recorded as lead source
 * gets the bonus once the customer pays in full (pending until then).
 */
export function leadBonus(
  input: {
    jobId: string;
    leadSourceUserId: string | null;
    soldBy: "tech" | "owner" | "manager";
    paidInFull: boolean;
  },
  amountCents: Cents = DEFAULT_LEAD_BONUS_CENTS,
): SpiffDecision {
  assertText(input.jobId, "jobId");
  assertNonNegativeInt(amountCents, "amountCents");
  if (input.soldBy === "tech") {
    return notEligible(
      ["A tech sold this replacement, so it earns GP credit instead of a lead bonus."],
      "No lead bonus:",
    );
  }
  if (input.leadSourceUserId === null) {
    return notEligible(["No tech is recorded as the lead source."], "No lead bonus:");
  }
  const status = lineStatusFor(input.paidInFull);
  return {
    eligible: true,
    userId: input.leadSourceUserId,
    ruleKind: "lead",
    payLineKind: "lead",
    amountCents,
    status,
    explanation:
      `Job ${input.jobId}: you turned over the lead and ${input.soldBy === "owner" ? "an owner" : "a manager"} sold the replacement, so you get a ${formatCents(amountCents)} lead bonus` +
      (input.paidInFull ? "." : " once the customer pays in full."),
  };
}
