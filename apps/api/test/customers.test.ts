import {
  businessUnits,
  contacts,
  customers,
  equipment,
  invoices,
  locations,
  membershipPlans,
  memberships,
  settings,
} from "@dwrg/db";
import {
  customerDetailSchema,
  customerListResponseSchema,
  RECENT_INVOICE_LIMIT,
} from "@dwrg/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REPLACEMENT_AGE_SETTING_KEY } from "../src/services/settings";
import { bodyAs, call, errorOf, loginAs, setupTestApp, type TestApp } from "./helpers";

/** "Today" for these tests: 2026-10-09 in New York. */
const NOW = new Date("2026-10-09T16:00:00Z");

let t: TestApp;
let cookie: string;
const ids = {} as Record<"alvarez" | "baker" | "carter" | "percent" | "bu" | "alvarezHome", string>;

beforeAll(async () => {
  t = await setupTestApp({ now: () => NOW });
  cookie = (await loginAs(t, { role: "dispatcher_csr" })).cookie;

  const [bu] = await t.db
    .insert(businessUnits)
    .values({ code: "hvac_service", name: "HVAC Service" })
    .returning();
  const [plan] = await t.db
    .insert(membershipPlans)
    .values({
      name: "Comfort Club",
      priceCents: 19900,
      visitKinds: ["spring_cooling", "fall_heating"],
    })
    .returning();
  if (!bu || !plan) throw new Error("fixture insert failed");
  ids.bu = bu.id;

  const [alvarez, baker, carter, percent] = await t.db
    .insert(customers)
    .values([
      { type: "residential", name: "Alvarez Residence", email: "maria@example.com" },
      {
        type: "commercial",
        name: "Baker Plumbing Supply",
        termsNetDays: 30,
        poRequired: true,
        billStreet: "9 Ledger Rd",
        billCity: "Hertford",
        billState: "NC",
        billZip: "27944",
      },
      { type: "residential", name: "Carter Home", deletedAt: new Date("2026-09-01T12:00:00Z") },
      { type: "residential", name: "100% Comfort_Test" },
    ])
    .returning();
  if (!alvarez || !baker || !carter || !percent) throw new Error("fixture insert failed");
  Object.assign(ids, {
    alvarez: alvarez.id,
    baker: baker.id,
    carter: carter.id,
    percent: percent.id,
  });

  const [home, store, warehouse] = await t.db
    .insert(locations)
    .values([
      {
        customerId: alvarez.id,
        street: "101 Main St",
        city: "Elizabeth City",
        zip: "27909",
        defaultBusinessUnitId: bu.id,
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
      {
        customerId: baker.id,
        name: "Store #4",
        street: "22 Water St",
        city: "Hertford",
        zip: "27944",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
      {
        customerId: baker.id,
        name: "Warehouse",
        street: "5 Caratoke Hwy",
        city: "Moyock",
        zip: "27958",
        createdAt: new Date("2026-02-01T00:00:00Z"),
      },
      { customerId: carter.id, street: "7 Gone Ln", city: "Camden", zip: "27921" },
    ])
    .returning();
  if (!home || !store || !warehouse) throw new Error("fixture insert failed");
  ids.alvarezHome = home.id;

  await t.db.insert(contacts).values([
    { customerId: alvarez.id, locationId: home.id, name: "Jose Alvarez", phone: "+12525550999" },
    {
      customerId: alvarez.id,
      locationId: home.id,
      name: "Maria Alvarez",
      phone: "+12525550123",
      isPrimary: true,
      textOptIn: true,
    },
    { customerId: baker.id, name: "Front Desk", phone: "+17575550199", altPhone: "+12525551234" },
    { customerId: carter.id, name: "Carl Carter", phone: "+12525550777" },
  ]);

  await t.db.insert(equipment).values([
    { locationId: home.id, kind: "furnace", brand: "Trane", installYear: 2008 },
    { locationId: home.id, kind: "ac", brand: "Trane", installYear: 2020 },
    { locationId: home.id, kind: "water_heater" },
    { locationId: store.id, kind: "rooftop_unit", installYear: 2015 },
  ]);

  await t.db.insert(memberships).values({
    locationId: home.id,
    planId: plan.id,
    status: "active",
    startDate: "2026-03-01",
    endDate: "2027-03-01",
    visitsRemaining: 1,
    priceCents: 19900,
  });

  const invoice = (
    customerId: string,
    number: string,
    invoiceDate: string,
    status: "draft" | "open" | "paid" | "void",
    totalCents: number,
    balanceCents: number,
  ) => ({
    customerId,
    number,
    invoiceDate,
    status,
    subtotalCents: totalCents,
    totalCents,
    balanceCents,
  });
  await t.db
    .insert(invoices)
    .values([
      invoice(alvarez.id, "A-1", "2026-05-01", "paid", 45_000, 0),
      invoice(alvarez.id, "A-2", "2026-09-15", "open", 12_345, 12_345),
      invoice(alvarez.id, "A-3", "2026-09-20", "open", 20_000, 5_001),
      invoice(alvarez.id, "A-4", "2026-09-21", "void", 9_999, 9_999),
      ...Array.from({ length: 12 }, (_, i) =>
        invoice(
          baker.id,
          `B-${i + 1}`,
          `2026-08-${String(i + 1).padStart(2, "0")}`,
          "paid",
          100,
          0,
        ),
      ),
    ]);
});

afterAll(async () => {
  await t?.close();
});

async function search(query: string) {
  const res = await call(t, `/api/customers?${query}`, { cookie });
  expect(res.status).toBe(200);
  return bodyAs(customerListResponseSchema, res);
}

const names = (body: { items: { name: string }[] }) => body.items.map((i) => i.name);

describe("GET /api/customers (search)", () => {
  it.each([
    "(252) 555-0123",
    "252-555-0123",
    "252.555.0123",
    "2525550123",
    "+1 252 555 0123",
    "5550123",
    "0123",
  ])("finds the caller by phone typed as %s", async (phone) => {
    const body = await search(new URLSearchParams({ q: phone }).toString());
    expect(names(body)).toEqual(["Alvarez Residence"]);
    expect(body.total).toBe(1);
  });

  it("finds by a contact's alternate phone", async () => {
    expect(names(await search("q=2525551234"))).toEqual(["Baker Plumbing Supply"]);
  });

  it("summarizes each customer: primary phone, first address, location count, member", async () => {
    const body = await search("q=alvarez");
    expect(body.items).toEqual([
      {
        id: ids.alvarez,
        stId: null,
        type: "residential",
        name: "Alvarez Residence",
        email: "maria@example.com",
        phone: "+12525550123",
        address: {
          name: null,
          street: "101 Main St",
          street2: null,
          city: "Elizabeth City",
          state: "NC",
          zip: "27909",
        },
        locationCount: 1,
        member: true,
      },
    ]);
    const baker = (await search("q=baker")).items[0];
    expect(baker).toMatchObject({ locationCount: 2, member: false, phone: "+17575550199" });
    expect(baker?.address?.name).toBe("Store #4");
  });

  it("finds by name, contact name, email, address, city, zip and site name", async () => {
    expect(names(await search("q=Maria"))).toEqual(["Alvarez Residence"]);
    expect(names(await search("q=maria%40example"))).toEqual(["Alvarez Residence"]);
    expect(names(await search("q=water+st"))).toEqual(["Baker Plumbing Supply"]);
    expect(names(await search("q=MOYOCK"))).toEqual(["Baker Plumbing Supply"]);
    expect(names(await search("q=27958"))).toEqual(["Baker Plumbing Supply"]);
    expect(names(await search("q=warehouse"))).toEqual(["Baker Plumbing Supply"]);
    expect(names(await search("q=101+Main"))).toEqual(["Alvarez Residence"]);
  });

  it("needs every word to match somewhere", async () => {
    expect(names(await search("q=main+elizabeth"))).toEqual(["Alvarez Residence"]);
    expect(names(await search("q=main+moyock"))).toEqual([]);
  });

  it("treats % and _ literally", async () => {
    expect(names(await search("q=%25"))).toEqual(["100% Comfort_Test"]);
    expect(names(await search("q=t_st"))).toEqual([]);
  });

  it("never shows deleted customers", async () => {
    expect(names(await search("q=5550777"))).toEqual([]);
    expect(names(await search("q=carter"))).toEqual([]);
    expect((await search("")).total).toBe(3);
  });

  it("filters by type and pages through the results by name", async () => {
    expect(names(await search("type=commercial"))).toEqual(["Baker Plumbing Supply"]);
    const all = await search("pageSize=2");
    expect(names(all)).toEqual(["100% Comfort_Test", "Alvarez Residence"]);
    expect(all).toMatchObject({ page: 1, pageSize: 2, total: 3 });
    const second = await search("pageSize=2&page=2");
    expect(names(second)).toEqual(["Baker Plumbing Supply"]);
    expect((await search("page=9")).items).toEqual([]);
  });

  it("rejects bad paging with field messages", async () => {
    const res = await call(t, "/api/customers?pageSize=1000&page=0", { cookie });
    expect(res.status).toBe(400);
    const error = await errorOf(res);
    expect(error.code).toBe("validation_failed");
    expect(error.fields).toEqual({
      pageSize: ["Must be 100 or less"],
      page: ["Must be 1 or more"],
    });
  });
});

describe("GET /api/customers/:id (the customer's file)", () => {
  it("has locations with equipment ages, the replacement flag and memberships", async () => {
    const res = await call(t, `/api/customers/${ids.alvarez}`, { cookie });
    expect(res.status).toBe(200);
    const body = await bodyAs(customerDetailSchema, res);
    expect(body).toMatchObject({
      id: ids.alvarez,
      name: "Alvarez Residence",
      billTo: null,
      asOf: "2026-10-09",
      replacementAgeYears: 15,
    });
    expect(body.locations).toHaveLength(1);
    const [home] = body.locations;
    expect(home?.defaultBusinessUnit).toEqual({
      id: ids.bu,
      code: "hvac_service",
      name: "HVAC Service",
    });
    expect(home?.replacementFlag).toBe(true);
    expect(
      home?.equipment.map((e) => [e.kind, e.installYear, e.ageYears, e.pastReplacementAge]),
    ).toEqual([
      ["furnace", 2008, 18, true],
      ["ac", 2020, 6, false],
      ["water_heater", null, null, false],
    ]);
    expect(home?.memberships).toEqual([
      expect.objectContaining({
        planName: "Comfort Club",
        status: "active",
        endDate: "2027-03-01",
        visitsRemaining: 1,
        priceCents: 19900,
      }),
    ]);
    expect(body.contacts.map((c) => c.name)).toEqual(["Maria Alvarez", "Jose Alvarez"]);
  });

  it("sums the open balance from open invoices only, in integer cents", async () => {
    const body = await bodyAs(
      customerDetailSchema,
      await call(t, `/api/customers/${ids.alvarez}`, { cookie }),
    );
    expect(body.openBalanceCents).toBe(12_345 + 5_001);
    expect(Number.isInteger(body.openBalanceCents)).toBe(true);
    expect(body.recentInvoices.map((i) => i.number)).toEqual(["A-4", "A-3", "A-2", "A-1"]);
    expect(body.recentInvoices[1]).toMatchObject({
      origin: "new",
      totalCents: 20_000,
      balanceCents: 5_001,
    });
  });

  it(`shows only the ${RECENT_INVOICE_LIMIT} most recent invoices`, async () => {
    const body = await bodyAs(
      customerDetailSchema,
      await call(t, `/api/customers/${ids.baker}`, { cookie }),
    );
    expect(body.recentInvoices).toHaveLength(RECENT_INVOICE_LIMIT);
    expect(body.recentInvoices[0]?.number).toBe("B-12");
    expect(body.billTo).toEqual({
      street: "9 Ledger Rd",
      street2: null,
      city: "Hertford",
      state: "NC",
      zip: "27944",
    });
    expect(body).toMatchObject({ termsNetDays: 30, poRequired: true, openBalanceCents: 0 });
    expect(body.locations.map((l) => l.name)).toEqual(["Store #4", "Warehouse"]);
  });

  it("is 404 for a deleted or unknown customer, 400 for a malformed id", async () => {
    expect((await call(t, `/api/customers/${ids.carter}`, { cookie })).status).toBe(404);
    const unknown = await call(t, "/api/customers/00000000-0000-4000-8000-000000000000", {
      cookie,
    });
    expect(unknown.status).toBe(404);
    expect((await errorOf(unknown)).code).toBe("not_found");
    const bad = await call(t, "/api/customers/not-a-uuid", { cookie });
    expect(bad.status).toBe(400);
    expect((await errorOf(bad)).fields).toEqual({ id: ["Must be a valid id"] });
  });

  it("uses the replacement-age setting in effect today (effective-dated)", async () => {
    const key = REPLACEMENT_AGE_SETTING_KEY;
    await t.db.insert(settings).values([
      { key, value: 10, effectiveFrom: "2026-01-01", effectiveTo: "2026-10-01" },
      { key, value: { years: 19 }, effectiveFrom: "2026-10-01", effectiveTo: "2026-11-01" },
      { key, value: 5, effectiveFrom: "2026-11-01" },
    ]);
    const body = await bodyAs(
      customerDetailSchema,
      await call(t, `/api/customers/${ids.alvarez}`, { cookie }),
    );
    expect(body.replacementAgeYears).toBe(19);
    expect(body.locations[0]?.equipment[0]).toMatchObject({
      ageYears: 18,
      pastReplacementAge: false,
    });
    expect(body.locations[0]?.replacementFlag).toBe(false);
  });
});
