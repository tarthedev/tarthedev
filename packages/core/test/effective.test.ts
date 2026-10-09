import { describe, expect, it } from "vitest";
import { pickEffective, pickEffectiveGroup, requireEffective } from "../src/index";

type BurdenRow = { effectiveFrom: string; effectiveTo?: string | null; burdenBps: number };

const rows: BurdenRow[] = [
  { effectiveFrom: "2026-01-01", burdenBps: 13_000 },
  { effectiveFrom: "2026-07-01", burdenBps: 13_500 },
];

describe("pickEffective", () => {
  it("picks the latest row that has started", () => {
    expect(pickEffective(rows, "2026-06-30")?.burdenBps).toBe(13_000);
    expect(pickEffective(rows, "2026-07-01")?.burdenBps).toBe(13_500); // inclusive start
    expect(pickEffective(rows, "2027-01-01")?.burdenBps).toBe(13_500);
  });

  it("returns undefined before anything applies", () => {
    expect(pickEffective(rows, "2025-12-31")).toBeUndefined();
    expect(() => requireEffective(rows, "2025-12-31", "burden")).toThrow(/No burden/);
  });

  it("treats effectiveTo as exclusive", () => {
    const bounded: BurdenRow[] = [
      { effectiveFrom: "2026-01-01", effectiveTo: "2026-02-01", burdenBps: 12_000 },
    ];
    expect(pickEffective(bounded, "2026-01-31")?.burdenBps).toBe(12_000);
    expect(pickEffective(bounded, "2026-02-01")).toBeUndefined();
  });

  it("does not depend on row order", () => {
    expect(pickEffective([...rows].reverse(), "2026-08-01")?.burdenBps).toBe(13_500);
  });

  it("throws on ambiguous or invalid rows", () => {
    const ambiguous: BurdenRow[] = [
      { effectiveFrom: "2026-01-01", burdenBps: 13_000 },
      { effectiveFrom: "2026-01-01", burdenBps: 14_000 },
    ];
    expect(() => pickEffective(ambiguous, "2026-03-01")).toThrow(RangeError);
    expect(() =>
      pickEffective(
        [{ effectiveFrom: "2026-02-01", effectiveTo: "2026-01-01", burdenBps: 1 }],
        "2026-03-01",
      ),
    ).toThrow(RangeError);
    expect(() => pickEffective(rows, "03/01/2026")).toThrow(RangeError);
  });
});

describe("pickEffectiveGroup", () => {
  it("returns every row of the version in effect (ladder steps)", () => {
    const steps = [
      { effectiveFrom: "2026-01-01", levelName: "Starter", rateBps: 500 },
      { effectiveFrom: "2026-01-01", levelName: "Bronze", rateBps: 800 },
      { effectiveFrom: "2026-06-01", levelName: "Starter", rateBps: 600 },
      { effectiveFrom: "2026-06-01", levelName: "Bronze", rateBps: 900 },
    ];
    expect(pickEffectiveGroup(steps, "2026-05-31").map((s) => s.rateBps)).toEqual([500, 800]);
    expect(pickEffectiveGroup(steps, "2026-06-01").map((s) => s.rateBps)).toEqual([600, 900]);
    expect(pickEffectiveGroup(steps, "2025-01-01")).toEqual([]);
  });
});
