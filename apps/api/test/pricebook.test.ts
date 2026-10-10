import { pricebookItems } from "@dwrg/db";
import { pricebookListResponseSchema } from "@dwrg/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bodyAs, call, loginAs, setupTestApp, type TestApp } from "./helpers";

let t: TestApp;
let cookie: string;

beforeAll(async () => {
  t = await setupTestApp();
  cookie = (await loginAs(t, { role: "dispatcher_csr" })).cookie;
  await t.db.insert(pricebookItems).values([
    {
      kind: "service",
      code: "TUNE-AC",
      name: "AC tune-up",
      category: "HVAC Maintenance",
      priceCents: 14_900,
      memberPriceCents: 0,
      costCents: 1_500,
      estMinutes: 60,
    },
    {
      kind: "equipment",
      code: "UV-1",
      name: "UV light",
      description: "Germicidal UV for the air handler",
      category: "Indoor Air Quality",
      priceCents: 89_500,
      memberPriceCents: 80_550,
      costCents: 21_000,
      taxable: true,
      spiffCents: 5_000,
      comboTags: ["uv_light"],
    },
    {
      kind: "material",
      code: "FLT-16",
      name: "Filter 16x25x1",
      category: "Indoor Air Quality",
      priceCents: 2_500,
      taxable: true,
    },
    {
      kind: "service",
      code: "OLD-1",
      name: "Retired service",
      category: "HVAC Maintenance",
      priceCents: 100,
      active: false,
    },
    {
      kind: "service",
      code: "DEL-1",
      name: "Deleted service",
      category: "HVAC Maintenance",
      priceCents: 100,
      deletedAt: new Date(),
    },
  ]);
});
afterAll(async () => {
  await t?.close();
});

async function list(query = "") {
  const res = await call(t, `/api/pricebook${query}`, { cookie });
  expect(res.status).toBe(200);
  return bodyAs(pricebookListResponseSchema, res);
}

const codes = (body: { items: { code: string }[] }) => body.items.map((i) => i.code);

describe("GET /api/pricebook", () => {
  it("lists active items by category then name, with money in integer cents", async () => {
    const body = await list();
    expect(codes(body)).toEqual(["TUNE-AC", "FLT-16", "UV-1"]);
    expect(body.total).toBe(3);
    expect(body.items[2]).toEqual({
      id: expect.any(String),
      stId: null,
      kind: "equipment",
      code: "UV-1",
      name: "UV light",
      description: "Germicidal UV for the air handler",
      category: "Indoor Air Quality",
      priceCents: 89_500,
      memberPriceCents: 80_550,
      costCents: 21_000,
      estMinutes: null,
      taxable: true,
      spiffCents: 5_000,
      comboTags: ["uv_light"],
      active: true,
    });
    expect(body.items[1]?.memberPriceCents).toBeNull();
  });

  it("filters by kind, category and words in code, name or description", async () => {
    expect(codes(await list("?kind=service"))).toEqual(["TUNE-AC"]);
    expect(codes(await list("?category=indoor+air+quality"))).toEqual(["FLT-16", "UV-1"]);
    expect(codes(await list("?q=germicidal"))).toEqual(["UV-1"]);
    expect(codes(await list("?q=flt"))).toEqual(["FLT-16"]);
    expect(codes(await list("?q=uv+handler"))).toEqual(["UV-1"]);
    expect(codes(await list("?q=uv+tune"))).toEqual([]);
  });

  it("shows inactive items only on request, and deleted ones never", async () => {
    expect(codes(await list("?includeInactive=true"))).toEqual([
      "TUNE-AC",
      "OLD-1",
      "FLT-16",
      "UV-1",
    ]);
    expect(codes(await list("?q=deleted&includeInactive=true"))).toEqual([]);
  });

  it("pages", async () => {
    const page = await list("?pageSize=2&page=2");
    expect(codes(page)).toEqual(["UV-1"]);
    expect(page).toMatchObject({ page: 2, pageSize: 2, total: 3 });
  });
});
