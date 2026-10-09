import { describe, expect, it } from "vitest";
import {
  bookableCallCount,
  bookedJobSpiff,
  bookingRateBonus,
  type ComboRule,
  DEFAULT_COMBO_RULES,
  DEFAULT_ITEM_SPIFF_RULES,
  DEFAULT_LEAD_BONUS_CENTS,
  DEFAULT_MEMBERSHIP_SPIFF_CENTS,
  DEFAULT_OFFICE_SPIFF_RULES,
  DEFAULT_REVIEW_SPIFF_RULE,
  evaluateInvoiceSpiffs,
  type InvoiceLine,
  type ItemSpiffRule,
  leadBonus,
  phoneMembershipSpiff,
  type ReviewInput,
  reviewSpiff,
} from "../src/index";

const solo = [{ userId: "tech-a", shareBps: 10_000 }];
const uv: InvoiceLine = { itemId: "uv-1", category: "uv_light", qty: 1 };
const surge: InvoiceLine = { itemId: "surge-1", category: "surge_protector", qty: 1 };
const membership: InvoiceLine = { itemId: "member-1", category: "membership", qty: 1 };
const leakValve: InvoiceLine = { itemId: "leak-1", category: "leak_shutoff_valve", qty: 1 };
const softener: InvoiceLine = { itemId: "soft-1", category: "water_softener", qty: 1 };

describe("default spiff amounts match the plan", () => {
  it("item spiffs", () => {
    const byLabel = Object.fromEntries(
      DEFAULT_ITEM_SPIFF_RULES.map((r) => [r.label, r.amountCents]),
    );
    expect(byLabel).toEqual({
      "UV light": 5_000,
      "Air purifier": 5_000,
      "Air scrubber": 5_000,
      "Whole-home dehumidifier": 7_500,
      "Surge protector": 2_000,
      "Whole-home water filter": 7_500,
      "Water softener": 7_500,
      "Leak-detection shut-off valve": 4_000,
      "Membership sold": 4_000,
    });
    expect(DEFAULT_MEMBERSHIP_SPIFF_CENTS).toBe(4_000);
    expect(DEFAULT_REVIEW_SPIFF_RULE.amountCents).toBe(2_000);
    expect(DEFAULT_LEAD_BONUS_CENTS).toBe(15_000);
    expect(DEFAULT_COMBO_RULES.map((c) => [c.label, c.amountCents])).toEqual([
      ["Clean Air Combo", 7_500],
      ["Water Guard Combo", 7_500],
    ]);
  });
});

describe("evaluateInvoiceSpiffs", () => {
  it("Water Guard Combo totals $230", () => {
    const result = evaluateInvoiceSpiffs({
      invoiceId: "I1",
      shares: solo,
      lines: [leakValve, { itemId: "filter-1", category: "water_filter", qty: 1 }, membership],
    });
    expect(result.totalCents).toBe(23_000);
  });

  it("counts a combo once per invoice even with doubled items", () => {
    const result = evaluateInvoiceSpiffs({
      invoiceId: "I1",
      shares: solo,
      lines: [{ ...uv, qty: 2 }, surge, { ...surge, itemId: "surge-2" }, { ...membership, qty: 2 }],
    });
    const combos = result.awards.filter((a) => a.ruleKind === "combo");
    expect(combos).toHaveLength(1);
    // Items: 2 × $50 + 2 × $20 + 2 × $40 = $220, plus one $75 combo.
    expect(result.totalCents).toBe(29_500);
  });

  it("pays every combo that is complete on the same invoice", () => {
    const result = evaluateInvoiceSpiffs({
      invoiceId: "I1",
      shares: solo,
      lines: [uv, surge, membership, leakValve, softener],
    });
    expect(result.awards.filter((a) => a.ruleKind === "combo").map((a) => a.label)).toEqual([
      "Clean Air Combo",
      "Water Guard Combo",
    ]);
    // Items $50 + $20 + $40 + $40 + $75 = $225, plus two $75 combos.
    expect(result.totalCents).toBe(37_500);
  });

  it("needs every combo item on the same invoice", () => {
    const first = evaluateInvoiceSpiffs({ invoiceId: "I1", shares: solo, lines: [uv, surge] });
    const second = evaluateInvoiceSpiffs({ invoiceId: "I2", shares: solo, lines: [membership] });
    expect(first.awards.some((a) => a.ruleKind === "combo")).toBe(false);
    expect(second.awards.some((a) => a.ruleKind === "combo")).toBe(false);
    expect(first.totalCents + second.totalCents).toBe(11_000);
  });

  it("nets out returned items", () => {
    const result = evaluateInvoiceSpiffs({
      invoiceId: "I1",
      shares: solo,
      lines: [uv, surge, membership, { ...uv, qty: -1 }],
    });
    expect(result.awards.map((a) => a.label)).toEqual(["Surge protector", "Membership sold"]);
    expect(result.totalCents).toBe(6_000);
  });

  it("splits spiffs with the same shares as GP, exact to the cent", () => {
    const result = evaluateInvoiceSpiffs({
      invoiceId: "I1",
      shares: [
        { userId: "tech-a", shareBps: 6_667 },
        { userId: "tech-b", shareBps: 3_333 },
      ],
      lines: [uv, surge, membership],
    });
    const a = result.byUser.find((u) => u.userId === "tech-a");
    const b = result.byUser.find((u) => u.userId === "tech-b");
    expect((a?.totalCents ?? 0) + (b?.totalCents ?? 0)).toBe(18_500);
    // $50 × 66.67% = $33.335 and $50 × 33.33% = $16.665: the leftover cent goes to the first tech.
    expect(a?.lines.find((l) => l.label === "UV light")?.amountCents).toBe(3_334);
    expect(b?.lines.find((l) => l.label === "UV light")?.amountCents).toBe(1_666);
    expect(a?.lines[0]?.explanation).toContain("same split as gross profit");
  });

  it("prefers an item-specific rule over a category rule", () => {
    const rules: ItemSpiffRule[] = [
      { kind: "item", label: "UV light", match: { category: "uv_light" }, amountCents: 5_000 },
      { kind: "item", label: "Premium UV", match: { itemId: "uv-premium" }, amountCents: 8_000 },
    ];
    const result = evaluateInvoiceSpiffs(
      {
        invoiceId: "I1",
        shares: solo,
        lines: [uv, { itemId: "uv-premium", category: "uv_light", qty: 1 }],
      },
      { items: rules, combos: [] },
    );
    expect(result.awards.map((a) => [a.label, a.amountCents])).toEqual([
      ["UV light", 5_000],
      ["Premium UV", 8_000],
    ]);
  });

  it("supports new combos from configuration and matches on tags", () => {
    const combo: ComboRule = {
      kind: "combo",
      label: "Smart Home Combo",
      requires: [["smart_thermostat"], ["uv_light", "air_purifier"]],
      amountCents: 2_500,
    };
    const result = evaluateInvoiceSpiffs(
      {
        invoiceId: "I1",
        shares: solo,
        lines: [
          { itemId: "t-1", category: "thermostats", tags: ["smart_thermostat"], qty: 1 },
          { itemId: "ap-1", category: "air_purifier", qty: 1 },
        ],
      },
      { items: DEFAULT_ITEM_SPIFF_RULES, combos: [combo] },
    );
    expect(result.totalCents).toBe(5_000 + 2_500);
    expect(result.awards.at(-1)?.explanation).toContain(
      "smart_thermostat + uv_light or air_purifier",
    );
  });

  it("ignores lines with no rule and allows fractional quantities on them", () => {
    const result = evaluateInvoiceSpiffs({
      invoiceId: "I1",
      shares: solo,
      lines: [{ itemId: "pipe", category: "copper", qty: 2.5 }],
    });
    expect(result.totalCents).toBe(0);
    expect(result.byUser[0]?.lines).toEqual([]);
  });

  it("rejects bad input", () => {
    expect(() => evaluateInvoiceSpiffs({ invoiceId: "I1", shares: [], lines: [uv] })).toThrow(
      RangeError,
    );
    expect(() =>
      evaluateInvoiceSpiffs({
        invoiceId: "I1",
        shares: [{ userId: "a", shareBps: 9_999 }],
        lines: [uv],
      }),
    ).toThrow(/100%/);
    expect(() =>
      evaluateInvoiceSpiffs({ invoiceId: "I1", shares: solo, lines: [{ ...uv, qty: 1.5 }] }),
    ).toThrow(RangeError);
    const clashing: ItemSpiffRule[] = [
      { kind: "item", label: "A", match: { category: "uv_light" }, amountCents: 1 },
      { kind: "item", label: "B", match: { category: "uv_light" }, amountCents: 2 },
    ];
    expect(() =>
      evaluateInvoiceSpiffs(
        { invoiceId: "I1", shares: solo, lines: [uv] },
        { items: clashing, combos: [] },
      ),
    ).toThrow(/equally/);
  });
});

describe("reviewSpiff", () => {
  const good: ReviewInput = {
    jobId: "J1",
    techUserId: "tech-a",
    platform: "google",
    stars: 5,
    mentionsTechByName: true,
    visitOn: "2026-03-02",
    postedOn: "2026-04-01",
    verifiedAt: "2026-04-02T14:00:00Z",
    reviewSpiffsAlreadyOnJob: 0,
    jobPaidInFull: true,
  };

  it("pays $20 for a verified 5-star Google review naming the tech within 30 days", () => {
    expect(reviewSpiff(good)).toMatchObject({
      eligible: true,
      amountCents: 2_000,
      userId: "tech-a",
    });
  });

  it.each([
    [{ stars: 4 }, "stars"],
    [{ platform: "yelp" }, "google"],
    [{ mentionsTechByName: false }, "name"],
    [{ postedOn: "2026-04-02" }, "31 days"],
    [{ verifiedAt: null }, "verified"],
    [{ reviewSpiffsAlreadyOnJob: 1 }, "one per job"],
  ] as const)("refuses %o", (change, reason) => {
    const result = reviewSpiff({ ...good, ...change });
    expect(result.eligible).toBe(false);
    expect(result.explanation).toContain(reason);
  });
});

describe("leadBonus", () => {
  it("is pending until the customer pays in full", () => {
    expect(
      leadBonus({ jobId: "R1", leadSourceUserId: "tech-a", soldBy: "manager", paidInFull: false }),
    ).toMatchObject({ eligible: true, status: "pending_payment", amountCents: 15_000 });
  });

  it("is not paid on tech-sold replacements or without a lead source", () => {
    expect(
      leadBonus({ jobId: "R1", leadSourceUserId: "tech-a", soldBy: "tech", paidInFull: true })
        .eligible,
    ).toBe(false);
    expect(
      leadBonus({ jobId: "R1", leadSourceUserId: null, soldBy: "owner", paidInFull: true })
        .eligible,
    ).toBe(false);
  });

  it("uses the configured amount", () => {
    expect(
      leadBonus({ jobId: "R1", leadSourceUserId: "t", soldBy: "owner", paidInFull: true }, 20_000),
    ).toMatchObject({ amountCents: 20_000 });
  });
});

describe("office spiffs", () => {
  it("booked job with a subtotal of at least $500 pays $5 when paid in full", () => {
    expect(
      bookedJobSpiff({
        jobId: "J1",
        bookedByUserId: "csr",
        subtotalCents: 50_000,
        paidInFull: true,
      }),
    ).toMatchObject({
      eligible: true,
      amountCents: 500,
      status: "payable",
      payLineKind: "booking",
    });
    expect(
      bookedJobSpiff({
        jobId: "J1",
        bookedByUserId: "csr",
        subtotalCents: 49_999,
        paidInFull: true,
      }).eligible,
    ).toBe(false);
    expect(
      bookedJobSpiff({
        jobId: "J1",
        bookedByUserId: "csr",
        subtotalCents: 80_000,
        paidInFull: false,
      }),
    ).toMatchObject({ status: "pending_payment" });
  });

  it("phone memberships: $15 sold, $10 renewed", () => {
    expect(
      phoneMembershipSpiff({ membershipId: "M1", userId: "csr", kind: "sold", paid: true }),
    ).toMatchObject({ amountCents: 1_500, ruleKind: "phone_membership", status: "payable" });
    expect(
      phoneMembershipSpiff({ membershipId: "M1", userId: "csr", kind: "renewed", paid: false }),
    ).toMatchObject({ amountCents: 1_000, ruleKind: "phone_renewal", status: "pending_payment" });
  });

  it("bookable calls exclude non-bookable tags", () => {
    expect(bookableCallCount(110, 20)).toBe(90);
    expect(() => bookableCallCount(5, 6)).toThrow(RangeError);
  });

  describe("booking-rate bonus", () => {
    it.each([
      [29, 29, 0, false], // under the 30-call minimum even at 100%
      [30, 23, 0, true], // 76.67%
      [30, 24, 5_000, true], // exactly 80%
      [30, 27, 10_000, true], // exactly 90%
      [10_000, 8_999, 5_000, true], // 89.99%
      [20_000, 17_999, 5_000, true], // 89.995% never rounds into 90%
      [40, 40, 10_000, true],
    ])("%i bookable, %i booked → %i", (bookable, booked, amount, qualified) => {
      const result = bookingRateBonus({
        userId: "csr",
        bookableCalls: bookable,
        bookedCalls: booked,
      });
      expect(result.amountCents).toBe(amount);
      expect(result.qualified).toBe(qualified);
    });

    it("shows the rate rounded down", () => {
      expect(
        bookingRateBonus({ userId: "csr", bookableCalls: 20_000, bookedCalls: 17_999 }).rateBps,
      ).toBe(8_999);
      expect(bookingRateBonus({ userId: "csr", bookableCalls: 0, bookedCalls: 0 }).rateBps).toBe(0);
    });

    it("uses configured tiers", () => {
      const rule = {
        minBookableCalls: 10,
        tiers: [{ minRateBps: 7_000, amountCents: 2_500 }],
      };
      expect(
        bookingRateBonus({ userId: "csr", bookableCalls: 10, bookedCalls: 7 }, rule).amountCents,
      ).toBe(2_500);
      expect(DEFAULT_OFFICE_SPIFF_RULES.bookingRate.minBookableCalls).toBe(30);
    });

    it("refuses more bookings than bookable calls", () => {
      expect(() => bookingRateBonus({ userId: "csr", bookableCalls: 30, bookedCalls: 31 })).toThrow(
        /call tags/,
      );
    });
  });
});
