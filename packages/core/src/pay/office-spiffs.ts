/**
 * Office spiffs for CSRs and dispatchers (docs/02-commission-plan.md section 8).
 * Credit goes to the user who created the booking (or sold or renewed the membership on the phone).
 *
 * The booking rate is compared with exact integer math (booked × 10_000 ≥ tier × bookable),
 * so a rate like 89.995% never rounds up into the 90% tier.
 */

import { assertNonNegativeInt, assertText } from "../internal/int";
import { BPS_SCALE, type Bps, type Cents, formatBps, formatCents } from "../money";
import { lineStatusFor } from "./payability";
import type { SpiffDecision } from "./spiffs";

export type BookingRateTier = { minRateBps: Bps; amountCents: Cents };

export type OfficeSpiffRules = {
  bookedSale: { minSubtotalCents: Cents; amountCents: Cents };
  phoneMembershipSold: { amountCents: Cents };
  phoneMembershipRenewed: { amountCents: Cents };
  bookingRate: { minBookableCalls: number; tiers: readonly BookingRateTier[] };
};

/** Starting office spiffs from the commission plan (section 8). */
export const DEFAULT_OFFICE_SPIFF_RULES: OfficeSpiffRules = Object.freeze({
  bookedSale: Object.freeze({ minSubtotalCents: 50_000, amountCents: 500 }),
  phoneMembershipSold: Object.freeze({ amountCents: 1_500 }),
  phoneMembershipRenewed: Object.freeze({ amountCents: 1_000 }),
  bookingRate: Object.freeze({
    minBookableCalls: 30,
    tiers: Object.freeze([
      Object.freeze({ minRateBps: 8_000, amountCents: 5_000 }),
      Object.freeze({ minRateBps: 9_000, amountCents: 10_000 }),
    ]),
  }),
});

/**
 * $5 when a job the user booked becomes a paid invoice with a subtotal of at least $500.
 * `subtotalCents` is the sale: after discounts, excluding tax.
 */
export function bookedJobSpiff(
  input: { jobId: string; bookedByUserId: string; subtotalCents: Cents; paidInFull: boolean },
  rule: OfficeSpiffRules["bookedSale"] = DEFAULT_OFFICE_SPIFF_RULES.bookedSale,
): SpiffDecision {
  assertText(input.jobId, "jobId");
  assertText(input.bookedByUserId, "bookedByUserId");
  const subtotal = assertNonNegativeInt(input.subtotalCents, "subtotalCents");
  assertNonNegativeInt(rule.minSubtotalCents, "rule.minSubtotalCents");
  assertNonNegativeInt(rule.amountCents, "rule.amountCents");
  if (subtotal < rule.minSubtotalCents) {
    const reason = `The invoice subtotal ${formatCents(subtotal)} is under ${formatCents(rule.minSubtotalCents)}.`;
    return { eligible: false, reasons: [reason], explanation: `No booking spiff: ${reason}` };
  }
  return {
    eligible: true,
    userId: input.bookedByUserId,
    ruleKind: "booked_sale",
    payLineKind: "booking",
    amountCents: rule.amountCents,
    status: lineStatusFor(input.paidInFull),
    explanation:
      `You booked job ${input.jobId} and its invoice subtotal is ${formatCents(subtotal)} (at least ${formatCents(rule.minSubtotalCents)}): ${formatCents(rule.amountCents)}` +
      (input.paidInFull ? "." : " once the invoice is paid in full."),
  };
}

/** $15 for a membership sold on the phone, $10 for one renewed on the phone, when paid. */
export function phoneMembershipSpiff(
  input: { membershipId: string; userId: string; kind: "sold" | "renewed"; paid: boolean },
  rules: Pick<
    OfficeSpiffRules,
    "phoneMembershipSold" | "phoneMembershipRenewed"
  > = DEFAULT_OFFICE_SPIFF_RULES,
): SpiffDecision {
  assertText(input.membershipId, "membershipId");
  assertText(input.userId, "userId");
  const sold = input.kind === "sold";
  const amountCents = assertNonNegativeInt(
    sold ? rules.phoneMembershipSold.amountCents : rules.phoneMembershipRenewed.amountCents,
    "amountCents",
  );
  return {
    eligible: true,
    userId: input.userId,
    ruleKind: sold ? "phone_membership" : "phone_renewal",
    payLineKind: "spiff",
    amountCents,
    status: lineStatusFor(input.paid),
    explanation:
      `Membership ${sold ? "sold" : "renewed"} on the phone: ${formatCents(amountCents)}` +
      (input.paid ? "." : " once it is paid."),
  };
}

/** Bookable calls = inbound calls the user answered minus calls tagged non-bookable. */
export function bookableCallCount(answeredInbound: number, taggedNonBookable: number): number {
  assertNonNegativeInt(answeredInbound, "answeredInbound");
  assertNonNegativeInt(taggedNonBookable, "taggedNonBookable");
  if (taggedNonBookable > answeredInbound) {
    throw new RangeError("More calls are tagged non-bookable than were answered");
  }
  return answeredInbound - taggedNonBookable;
}

export type BookingRateResult = {
  userId: string;
  bookableCalls: number;
  bookedCalls: number;
  /** Booking rate in basis points, rounded down (for display; tiers use exact comparison). */
  rateBps: Bps;
  qualified: boolean;
  amountCents: Cents;
  tier: BookingRateTier | null;
  explanation: string;
};

/**
 * Weekly booking-rate bonus: booked ÷ bookable, at least the minimum number of bookable calls.
 * Pays the highest tier reached (default: 80% → $50, 90% → $100), in that week's payroll.
 */
export function bookingRateBonus(
  input: { userId: string; bookableCalls: number; bookedCalls: number },
  rule: OfficeSpiffRules["bookingRate"] = DEFAULT_OFFICE_SPIFF_RULES.bookingRate,
): BookingRateResult {
  assertText(input.userId, "userId");
  const bookable = assertNonNegativeInt(input.bookableCalls, "bookableCalls");
  const booked = assertNonNegativeInt(input.bookedCalls, "bookedCalls");
  const minCalls = assertNonNegativeInt(rule.minBookableCalls, "rule.minBookableCalls");
  if (booked > bookable) {
    throw new RangeError(
      `Booked calls (${booked}) can't exceed bookable calls (${bookable}); check the call tags`,
    );
  }
  const seen = new Set<number>();
  const tiers = [...rule.tiers].sort((a, b) => b.minRateBps - a.minRateBps);
  tiers.forEach((tier, index) => {
    assertNonNegativeInt(tier.minRateBps, `tiers[${index}].minRateBps`);
    assertNonNegativeInt(tier.amountCents, `tiers[${index}].amountCents`);
    if (seen.has(tier.minRateBps)) {
      throw new RangeError(`Two booking-rate tiers start at ${formatBps(tier.minRateBps)}`);
    }
    seen.add(tier.minRateBps);
  });

  const scaled = booked * BPS_SCALE;
  // Exact integer floor division (no floating-point rounding).
  const rateBps = bookable === 0 ? 0 : (scaled - (scaled % bookable)) / bookable;
  const rateText = `${booked} booked of ${bookable} bookable calls (${formatBps(rateBps)})`;
  const base = { userId: input.userId, bookableCalls: bookable, bookedCalls: booked, rateBps };

  if (bookable < minCalls) {
    return {
      ...base,
      qualified: false,
      amountCents: 0,
      tier: null,
      explanation: `${rateText}. The booking-rate bonus needs at least ${minCalls} bookable calls in the week, so no bonus.`,
    };
  }
  const tier =
    tiers.find((candidate) => booked * BPS_SCALE >= candidate.minRateBps * bookable) ?? null;
  if (!tier) {
    const lowest = tiers.at(-1);
    return {
      ...base,
      qualified: true,
      amountCents: 0,
      tier: null,
      explanation: `${rateText}.${lowest ? ` The bonus starts at ${formatBps(lowest.minRateBps)},` : ""} so no bonus this week.`,
    };
  }
  return {
    ...base,
    qualified: true,
    amountCents: tier.amountCents,
    tier,
    explanation: `${rateText}: at least ${formatBps(tier.minRateBps)}, so the booking-rate bonus is ${formatCents(tier.amountCents)}.`,
  };
}
