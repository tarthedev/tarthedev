import { describe, expect, it } from "vitest";
import { dependencyOrder } from "../src/reports/invoices";

describe("dependencyOrder", () => {
  it("keeps the original order when nothing depends on anything", () => {
    expect(dependencyOrder(4, () => [])).toEqual([0, 1, 2, 3]);
  });

  it("puts what a row depends on first (a job before its callbacks, chains too)", () => {
    // 0 is a callback of 2; 1 is a callback of 0; 3 stands alone.
    const deps: Record<number, number[]> = { 0: [2], 1: [0] };
    expect(dependencyOrder(4, (i) => deps[i] ?? [])).toEqual([2, 0, 1, 3]);
  });

  it("survives a cycle and out-of-range references, listing every index once", () => {
    const deps: Record<number, number[]> = { 0: [1], 1: [0, 9], 2: [-1] };
    const order = dependencyOrder(3, (i) => deps[i] ?? []);
    expect([...order].sort()).toEqual([0, 1, 2]);
  });

  it("handles long chains without deep recursion", () => {
    const n = 50_000;
    const order = dependencyOrder(n, (i) => (i + 1 < n ? [i + 1] : []));
    expect(order[0]).toBe(n - 1);
    expect(order.at(-1)).toBe(0);
  });
});
