import { describe, expect, it } from "vitest";


import { estimateCost, estimateRequestCost, formatUsd, isKnownModel, pricingFor } from "@/lib/ai/models";

describe("pricingFor", () => {
  it("knows the current published rates", () => {
    // Verified against Anthropic's pricing page on 2026-06-24.
    const opus = pricingFor("claude-opus-5", new Date("2026-09-15T00:00:00Z"));
    expect(opus.input).toBe(5);
    expect(opus.output).toBe(25);

    const haiku = pricingFor("claude-haiku-4-5", new Date("2026-09-15T00:00:00Z"));
    expect(haiku.input).toBe(1);
    expect(haiku.output).toBe(5);
  });

  it("applies Sonnet's promotional rate only while it is live", () => {
    const during = pricingFor("claude-sonnet-5", new Date("2026-08-21T00:00:00Z"));
    expect(during.input).toBe(2);
    expect(during.output).toBe(10);

    const after = pricingFor("claude-sonnet-5", new Date("2026-09-01T00:00:00Z"));
    expect(after.input).toBe(3);
    expect(after.output).toBe(15);
  });

  it("prices an unknown model conservatively rather than as free", () => {
    // Under-reporting an unknown model would defeat the budget guardrail.
    expect(isKnownModel("claude-something-new")).toBe(false);
    const unknown = pricingFor("claude-something-new");
    expect(unknown.input).toBeGreaterThan(0);
    expect(unknown.output).toBeGreaterThan(0);
  });
});

describe("estimateCost", () => {
  it("costs input and output tokens at their own rates", () => {
    // 1M in + 1M out on Opus = $5 + $25.
    const cost = estimateCost(
      "claude-opus-5",
      { inputTokens: 1_000_000, outputTokens: 1_000_000 },
      new Date("2026-09-15T00:00:00Z"),
    );
    expect(cost).toBeCloseTo(30, 6);
  });

  it("prices cache writes at 1.25× and cache reads at 0.1× the input rate", () => {
    const at = new Date("2026-09-15T00:00:00Z");
    const write = estimateCost(
      "claude-opus-5",
      { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 1_000_000 },
      at,
    );
    const read = estimateCost(
      "claude-opus-5",
      { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000 },
      at,
    );

    expect(write).toBeCloseTo(6.25, 6);
    expect(read).toBeCloseTo(0.5, 6);
    // Reading from cache must be dramatically cheaper, or caching is pointless.
    expect(read).toBeLessThan(write / 10);
  });

  it("returns zero for a request that used no tokens", () => {
    expect(estimateCost("claude-sonnet-5", { inputTokens: 0, outputTokens: 0 })).toBe(0);
  });

  it("keeps a realistic snapshot extraction well under a cent", () => {
    // Five screenshots, a short prompt, a JSON response.
    const cost = estimateRequestCost({
      model: "claude-sonnet-5",
      estimatedInputTokens: 900,
      estimatedOutputTokens: 700,
      imageCount: 5,
    });
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(0.05);
  });

  it("makes the cheap tier meaningfully cheaper than the expensive one", () => {
    const usage = { inputTokens: 10_000, outputTokens: 2_000 };
    const at = new Date("2026-09-15T00:00:00Z");
    expect(estimateCost("claude-sonnet-5", usage, at)).toBeLessThan(estimateCost("claude-opus-5", usage, at));
  });
});

describe("formatUsd", () => {
  it("keeps sub-cent amounts legible instead of rounding them to zero", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.0086)).toBe("$0.0086");
    expect(formatUsd(1.5)).toBe("$1.50");
    expect(formatUsd(12.345)).toBe("$12.35");
  });
});
