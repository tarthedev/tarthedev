/**
 * Spec tests for docs/02-commission-plan.md section 8: office spiffs (CSRs and dispatchers).
 */
import { describe, expect, it } from "vitest";
import {
  bookableCallCount,
  bookedJobSpiff,
  bookingRateBonus,
  DEFAULT_OFFICE_SPIFF_RULES,
  phoneMembershipSpiff,
} from "../../src/index";

describe("Booked a job that becomes a paid invoice with subtotal ≥ $500 → $5", () => {
  it.each([
    [50_000, true],
    [50_001, true],
    [120_000, true],
    [49_999, false],
    [0, false],
  ])("subtotal %i cents → eligible %s", (subtotal, eligible) => {
    const decision = bookedJobSpiff({
      jobId: "J1",
      bookedByUserId: "csr",
      subtotalCents: subtotal,
      paidInFull: true,
    });
    expect(decision.eligible).toBe(eligible);
    if (decision.eligible) {
      expect(decision.amountCents).toBe(500);
      expect(decision.userId).toBe("csr");
      expect(decision.status).toBe("payable");
    }
  });

  it("is paid when the invoice is paid in full, not before", () => {
    const decision = bookedJobSpiff({
      jobId: "J1",
      bookedByUserId: "csr",
      subtotalCents: 60_000,
      paidInFull: false,
    });
    expect(decision.eligible && decision.status).toBe("pending_payment");
  });
});

describe("Memberships on the phone: $15 sold, $10 renewed, when paid", () => {
  it("sold → $15", () => {
    const decision = phoneMembershipSpiff({
      membershipId: "M1",
      userId: "csr",
      kind: "sold",
      paid: true,
    });
    expect(decision).toMatchObject({ eligible: true, amountCents: 1_500, status: "payable" });
  });

  it("renewed → $10", () => {
    const decision = phoneMembershipSpiff({
      membershipId: "M1",
      userId: "csr",
      kind: "renewed",
      paid: true,
    });
    expect(decision).toMatchObject({ eligible: true, amountCents: 1_000 });
  });

  it("waits for payment", () => {
    const decision = phoneMembershipSpiff({
      membershipId: "M1",
      userId: "csr",
      kind: "sold",
      paid: false,
    });
    expect(decision.eligible && decision.status).toBe("pending_payment");
  });
});

describe("Booking rate = booked ÷ bookable; bookable = answered inbound − non-bookable", () => {
  it("bookable calls subtract the non-bookable tags", () => {
    expect(bookableCallCount(100, 10)).toBe(90);
    expect(bookableCallCount(30, 0)).toBe(30);
    expect(() => bookableCallCount(10, 11)).toThrow();
  });

  it("the starting rules", () => {
    expect(DEFAULT_OFFICE_SPIFF_RULES.bookingRate.minBookableCalls).toBe(30);
    expect(DEFAULT_OFFICE_SPIFF_RULES.bookedSale).toEqual({
      minSubtotalCents: 50_000,
      amountCents: 500,
    });
  });

  it.each([
    // [bookable, booked, cents]
    [100, 79, 0],
    [100, 80, 5_000], // exactly 80%
    [100, 89, 5_000],
    [10_000, 8_999, 5_000], // 89.99%
    [20_000, 17_999, 5_000], // 89.995% is not 90%
    [100, 90, 10_000], // exactly 90%
    [100, 100, 10_000],
    [90, 76, 5_000], // example 12: 84.4%
    [30, 24, 5_000], // exactly 30 calls, exactly 80%
    [30, 27, 10_000], // exactly 30 calls, exactly 90%
    [30, 23, 0], // 76.7%
    [29, 29, 0], // under the 30-call minimum
    [25, 23, 0], // example 12: 92% on 25 calls
    [0, 0, 0],
  ])("%i bookable, %i booked → %i cents", (bookable, booked, cents) => {
    const result = bookingRateBonus({
      userId: "csr",
      bookableCalls: bookable,
      bookedCalls: booked,
    });
    expect(result.amountCents).toBe(cents);
    expect(result.qualified).toBe(bookable >= 30);
  });

  it("reports the rate in basis points, rounded down", () => {
    expect(bookingRateBonus({ userId: "csr", bookableCalls: 90, bookedCalls: 76 }).rateBps).toBe(
      8_444,
    );
    expect(bookingRateBonus({ userId: "csr", bookableCalls: 3, bookedCalls: 2 }).rateBps).toBe(
      6_666,
    );
  });

  it("agrees with exact integer math at every tier edge from 30 to 400 calls", () => {
    for (let bookable = 30; bookable <= 400; bookable++) {
      for (let booked = 0; booked <= bookable; booked++) {
        // Exact: rate ≥ 90% ⇔ 10·booked ≥ 9·bookable; ≥ 80% ⇔ 10·booked ≥ 8·bookable.
        const expected =
          10 * booked >= 9 * bookable ? 10_000 : 10 * booked >= 8 * bookable ? 5_000 : 0;
        const result = bookingRateBonus({
          userId: "csr",
          bookableCalls: bookable,
          bookedCalls: booked,
        });
        if (result.amountCents !== expected) {
          throw new Error(`${booked}/${bookable}: got ${result.amountCents}, want ${expected}`);
        }
      }
    }
  });

  it("explains the result", () => {
    const result = bookingRateBonus({ userId: "csr", bookableCalls: 25, bookedCalls: 23 });
    expect(result.explanation).toContain("30");
  });
});
