/**
 * Spec tests for docs/02-commission-plan.md section 7: tech spiffs and combo bonuses.
 */
import { describe, expect, it } from "vitest";
import {
  type ComboRule,
  DEFAULT_COMBO_RULES,
  DEFAULT_ITEM_SPIFF_RULES,
  DEFAULT_LEAD_BONUS_CENTS,
  DEFAULT_MEMBERSHIP_SPIFF_CENTS,
  evaluateInvoiceSpiffs,
  type InvoiceLine,
  type ItemSpiffRule,
  type ReviewInput,
  reviewSpiff,
} from "../../src/index";

const solo = [{ userId: "tech", shareBps: 10_000 }];

function spiffs(lines: InvoiceLine[], shares = solo, invoiceId = "INV-1") {
  return evaluateInvoiceSpiffs({ invoiceId, lines, shares });
}

function line(category: string, qty = 1, itemId = `${category}-item`): InvoiceLine {
  return { itemId, category, qty };
}

describe("Item spiff table", () => {
  it.each([
    ["uv_light", 5_000],
    ["air_purifier", 5_000],
    ["air_scrubber", 5_000],
    ["whole_home_dehumidifier", 7_500],
    ["surge_protector", 2_000],
    ["water_filter", 7_500],
    ["water_softener", 7_500],
    ["leak_shutoff_valve", 4_000],
    ["membership", 4_000],
  ])("%s pays %i cents", (category, cents) => {
    const result = spiffs([line(category)]);
    expect(result.totalCents).toBe(cents);
    expect(result.awards).toHaveLength(1);
  });

  it("the starting amounts are exported", () => {
    expect(DEFAULT_MEMBERSHIP_SPIFF_CENTS).toBe(4_000);
    expect(DEFAULT_LEAD_BONUS_CENTS).toBe(15_000);
  });

  it("items without a spiff pay nothing", () => {
    const result = spiffs([{ itemId: "capacitor", category: "parts", qty: 3 }]);
    expect(result.totalCents).toBe(0);
    expect(result.awards).toEqual([]);
  });

  it("pays per unit: 2 UV lights → $100", () => {
    expect(spiffs([line("uv_light", 2)]).totalCents).toBe(10_000);
    expect(spiffs([line("uv_light"), line("uv_light", 1, "uv-2")]).totalCents).toBe(10_000);
  });

  it("any pricebook item can carry a spiff", () => {
    const items: ItemSpiffRule[] = [
      { kind: "item", label: "Smart thermostat", match: { itemId: "tstat-9" }, amountCents: 1_500 },
    ];
    const result = evaluateInvoiceSpiffs(
      { invoiceId: "INV-T", shares: solo, lines: [{ itemId: "tstat-9", qty: 2 }] },
      { items, combos: [] },
    );
    expect(result.totalCents).toBe(3_000);
  });

  it("a returned item nets out", () => {
    const result = spiffs([line("uv_light", 2), line("uv_light", -1)]);
    expect(result.totalCents).toBe(5_000);
    expect(spiffs([line("uv_light", 1), line("uv_light", -1)]).totalCents).toBe(0);
  });
});

describe("Spiffs are credited to the tech(s) on the invoice using the same split as GP", () => {
  it("a 75/25 split on a UV light → $37.50 / $12.50", () => {
    const result = spiffs(
      [line("uv_light")],
      [
        { userId: "a", shareBps: 7_500 },
        { userId: "b", shareBps: 2_500 },
      ],
    );
    expect(result.byUser.map((u) => [u.userId, u.totalCents])).toEqual([
      ["a", 3_750],
      ["b", 1_250],
    ]);
  });

  it("the split never loses or makes a cent", () => {
    const result = spiffs(
      [line("surge_protector")],
      [
        { userId: "a", shareBps: 3_334 },
        { userId: "b", shareBps: 3_333 },
        { userId: "c", shareBps: 3_333 },
      ],
    );
    expect(result.byUser.reduce((sum, u) => sum + u.totalCents, 0)).toBe(2_000);
    expect(result.totalCents).toBe(2_000);
  });

  it("the combo bonus is split the same way", () => {
    const result = spiffs(
      [line("uv_light"), line("surge_protector"), line("membership")],
      [
        { userId: "a", shareBps: 7_500 },
        { userId: "b", shareBps: 2_500 },
      ],
    );
    expect(result.totalCents).toBe(18_500);
    expect(result.byUser.map((u) => u.totalCents)).toEqual([13_875, 4_625]);
  });

  it("every per-user line has an explanation", () => {
    const result = spiffs([line("uv_light"), line("surge_protector"), line("membership")]);
    for (const user of result.byUser) {
      for (const userLine of user.lines) expect(userLine.explanation).toContain("INV-1");
    }
  });
});

describe("Combo bonuses: in addition to each item's spiff, once per invoice per combo", () => {
  it("Clean Air Combo: UV + surge + membership → $50 + $20 + $40 + $75 = $185", () => {
    const result = spiffs([line("uv_light"), line("surge_protector"), line("membership")]);
    expect(result.totalCents).toBe(18_500);
    const combo = result.awards.find((a) => a.ruleKind === "combo");
    expect(combo).toMatchObject({ label: "Clean Air Combo", amountCents: 7_500, quantity: 1 });
  });

  it.each(["water_filter", "water_softener"])(
    "Water Guard Combo with a %s: $40 + $75 + $40 + $75 = $230",
    (water) => {
      const result = spiffs([line("leak_shutoff_valve"), line(water), line("membership")]);
      expect(result.totalCents).toBe(23_000);
      expect(result.awards.filter((a) => a.ruleKind === "combo")).toHaveLength(1);
    },
  );

  it("doubling every item still pays the combo only once", () => {
    const result = spiffs([line("uv_light", 2), line("surge_protector", 2), line("membership", 2)]);
    expect(result.totalCents).toBe(10_000 + 4_000 + 8_000 + 7_500);
    expect(result.awards.filter((a) => a.ruleKind === "combo")).toHaveLength(1);
  });

  it("every item must be on the same invoice", () => {
    const a = spiffs([line("uv_light"), line("surge_protector")], solo, "INV-A");
    const b = spiffs([line("membership")], solo, "INV-B");
    expect(a.totalCents + b.totalCents).toBe(5_000 + 2_000 + 4_000);
    expect([...a.awards, ...b.awards].some((award) => award.ruleKind === "combo")).toBe(false);
  });

  it("a missing item means no combo", () => {
    expect(spiffs([line("uv_light"), line("membership")]).totalCents).toBe(9_000);
    expect(spiffs([line("leak_shutoff_valve"), line("membership")]).totalCents).toBe(8_000);
  });

  it("a returned combo item breaks the combo", () => {
    const result = spiffs([
      line("uv_light"),
      line("surge_protector"),
      line("membership"),
      line("surge_protector", -1),
    ]);
    expect(result.totalCents).toBe(5_000 + 4_000);
  });

  it("both combos on one invoice each pay once (one membership completes both)", () => {
    const result = spiffs([
      line("uv_light"),
      line("surge_protector"),
      line("leak_shutoff_valve"),
      line("water_filter"),
      line("membership"),
    ]);
    expect(result.awards.filter((a) => a.ruleKind === "combo").map((a) => a.label)).toEqual([
      "Clean Air Combo",
      "Water Guard Combo",
    ]);
    expect(result.totalCents).toBe(5_000 + 2_000 + 4_000 + 7_500 + 4_000 + 7_500 + 7_500);
  });

  it("combos are configurable rules: a new one works without code changes", () => {
    const comfort: ComboRule = {
      kind: "combo",
      label: "Comfort Combo",
      requires: [["whole_home_dehumidifier"], ["air_purifier", "air_scrubber"]],
      amountCents: 6_000,
    };
    const result = evaluateInvoiceSpiffs(
      {
        invoiceId: "INV-C",
        shares: solo,
        lines: [line("whole_home_dehumidifier"), line("air_scrubber")],
      },
      { items: DEFAULT_ITEM_SPIFF_RULES, combos: [...DEFAULT_COMBO_RULES, comfort] },
    );
    expect(result.totalCents).toBe(7_500 + 5_000 + 6_000);
  });
});

describe("Review spiff: 5 stars on Google, names the tech, within 30 days, verified, one per job", () => {
  const good: ReviewInput = {
    jobId: "J1",
    techUserId: "tech",
    platform: "google",
    stars: 5,
    mentionsTechByName: true,
    visitOn: "2026-10-06",
    postedOn: "2026-10-08",
    verifiedAt: "2026-10-09T14:00:00Z",
    reviewSpiffsAlreadyOnJob: 0,
  };

  it("pays $20 when every condition holds", () => {
    expect(reviewSpiff(good)).toMatchObject({
      eligible: true,
      userId: "tech",
      amountCents: 2_000,
    });
  });

  it.each([
    ["4 stars", { stars: 4 }],
    ["not Google", { platform: "yelp" }],
    ["doesn't name the tech", { mentionsTechByName: false }],
    ["posted 31 days after the visit", { postedOn: "2026-11-06" }],
    ["not verified by the office", { verifiedAt: null }],
    ["a second review on the same job", { reviewSpiffsAlreadyOnJob: 1 }],
  ])("pays nothing when %s", (_, change) => {
    expect(reviewSpiff({ ...good, ...change }).eligible).toBe(false);
  });

  it("a review posted on day 30 still counts", () => {
    expect(reviewSpiff({ ...good, postedOn: "2026-11-05" }).eligible).toBe(true);
  });

  it("Google is matched regardless of capitalization", () => {
    expect(reviewSpiff({ ...good, platform: "Google" }).eligible).toBe(true);
  });
});
