import type { LocalDate } from "@dwrg/core";
import {
  businessUnits,
  contacts,
  customers,
  type Database,
  equipment,
  invoices,
  locations,
  membershipPlans,
  memberships,
} from "@dwrg/db";
import {
  type CustomerDetail,
  type CustomerListResponse,
  type CustomerSearchQuery,
  type CustomerSummary,
  type EquipmentSummary,
  RECENT_INVOICE_LIMIT,
} from "@dwrg/shared";
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  ilike,
  inArray,
  isNull,
  like,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { containsPattern, phoneDigits, searchWords } from "./search";
import { replacementAgeYears } from "./settings";

/**
 * Customer search for phones and booking (docs/01-operations.md): by name,
 * phone or address, across the customer, its service locations and its
 * contacts. Soft-deleted rows never show.
 */
export async function searchCustomers(
  db: Database,
  query: CustomerSearchQuery,
): Promise<CustomerListResponse> {
  const conditions: SQL[] = [isNull(customers.deletedAt)];
  if (query.type) conditions.push(eq(customers.type, query.type));
  if (query.q) conditions.push(matchCustomer(db, query.q));
  const where = and(...conditions);

  const [counted] = await db.select({ total: count() }).from(customers).where(where);
  const rows = await db
    .select({
      id: customers.id,
      stId: customers.stId,
      type: customers.type,
      name: customers.name,
      email: customers.email,
    })
    .from(customers)
    .where(where)
    .orderBy(asc(sql`lower(${customers.name})`), asc(customers.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  return {
    items: await summarize(db, rows),
    page: query.page,
    pageSize: query.pageSize,
    total: counted?.total ?? 0,
  };
}

/**
 * A phone-like query matches contacts' phones by digits (phones are stored
 * E.164, so "(252) 555-0123" finds +12525550123) or a street/zip containing
 * it. Otherwise every word must match a name, email, address or site name.
 */
function matchCustomer(db: Database, q: string): SQL {
  const digits = phoneDigits(q);
  if (digits) {
    const p = containsPattern(digits);
    const text = containsPattern(q);
    return or(
      contactMatch(db, or(like(contacts.phone, p), like(contacts.altPhone, p))),
      locationMatch(db, or(ilike(locations.street, text), ilike(locations.zip, text))),
      ilike(customers.billStreet, text),
      ilike(customers.billZip, text),
    ) as SQL;
  }
  const words = searchWords(q).map((word) => {
    const p = containsPattern(word);
    return or(
      ilike(customers.name, p),
      ilike(customers.email, p),
      ilike(customers.billStreet, p),
      ilike(customers.billCity, p),
      ilike(customers.billZip, p),
      sql`lower(${customers.stId}) = lower(${word})`,
      locationMatch(
        db,
        or(
          ilike(locations.street, p),
          ilike(locations.city, p),
          ilike(locations.zip, p),
          ilike(locations.name, p),
        ),
      ),
      contactMatch(db, or(ilike(contacts.name, p), ilike(contacts.email, p))),
    ) as SQL;
  });
  return and(...words) as SQL;
}

function locationMatch(db: Database, condition: SQL | undefined): SQL {
  return exists(
    db
      .select({ one: sql`1` })
      .from(locations)
      .where(and(eq(locations.customerId, customers.id), isNull(locations.deletedAt), condition)),
  );
}

function contactMatch(db: Database, condition: SQL | undefined): SQL {
  return exists(
    db
      .select({ one: sql`1` })
      .from(contacts)
      .where(and(eq(contacts.customerId, customers.id), isNull(contacts.deletedAt), condition)),
  );
}

type CustomerRow = Pick<CustomerSummary, "id" | "stId" | "type" | "name" | "email">;

/** Adds phone, first address, location count and member status to a page of customers. */
async function summarize(db: Database, rows: CustomerRow[]): Promise<CustomerSummary[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const locationRows = await db
    .select({
      id: locations.id,
      customerId: locations.customerId,
      name: locations.name,
      street: locations.street,
      street2: locations.street2,
      city: locations.city,
      state: locations.state,
      zip: locations.zip,
    })
    .from(locations)
    .where(and(inArray(locations.customerId, ids), isNull(locations.deletedAt)))
    .orderBy(asc(locations.createdAt), asc(locations.stId), asc(locations.id));

  const contactRows = await db
    .select({ customerId: contacts.customerId, phone: contacts.phone })
    .from(contacts)
    .where(
      and(
        inArray(contacts.customerId, ids),
        isNull(contacts.deletedAt),
        sql`${contacts.phone} is not null`,
      ),
    )
    .orderBy(
      desc(contacts.isPrimary),
      asc(contacts.createdAt),
      asc(contacts.stId),
      asc(contacts.id),
    );

  const memberRows = await db
    .selectDistinct({ customerId: locations.customerId })
    .from(memberships)
    .innerJoin(locations, eq(memberships.locationId, locations.id))
    .where(
      and(
        inArray(locations.customerId, ids),
        eq(memberships.status, "active"),
        isNull(memberships.deletedAt),
        isNull(locations.deletedAt),
      ),
    );
  const members = new Set(memberRows.map((r) => r.customerId));

  return rows.map((row) => {
    const own = locationRows.filter((l) => l.customerId === row.id);
    const first = own[0];
    return {
      ...row,
      phone: contactRows.find((c) => c.customerId === row.id)?.phone ?? null,
      address: first
        ? {
            name: first.name,
            street: first.street,
            street2: first.street2,
            city: first.city,
            state: first.state,
            zip: first.zip,
          }
        : null,
      locationCount: own.length,
      member: members.has(row.id),
    };
  });
}

/**
 * The customer's file: service locations with equipment (and its age) and
 * memberships, contacts, open balance and recent invoices. Undefined when
 * there is no such customer (or it was deleted).
 */
export async function getCustomerDetail(
  db: Database,
  id: string,
  asOf: LocalDate,
): Promise<CustomerDetail | undefined> {
  const [customer] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, id), isNull(customers.deletedAt)));
  if (!customer) return undefined;

  const ageLimit = await replacementAgeYears(db, asOf);
  const asOfYear = Number(asOf.slice(0, 4));

  const locationRows = await db
    .select({
      location: locations,
      unit: { id: businessUnits.id, code: businessUnits.code, name: businessUnits.name },
    })
    .from(locations)
    .leftJoin(businessUnits, eq(locations.defaultBusinessUnitId, businessUnits.id))
    .where(and(eq(locations.customerId, id), isNull(locations.deletedAt)))
    .orderBy(asc(locations.createdAt), asc(locations.stId), asc(locations.id));
  const locationIds = locationRows.map((r) => r.location.id);

  const equipmentRows =
    locationIds.length === 0
      ? []
      : await db
          .select()
          .from(equipment)
          .where(and(inArray(equipment.locationId, locationIds), isNull(equipment.deletedAt)))
          .orderBy(
            sql`${equipment.installYear} asc nulls last`,
            asc(equipment.kind),
            asc(equipment.id),
          );

  const membershipRows =
    locationIds.length === 0
      ? []
      : await db
          .select({ membership: memberships, planName: membershipPlans.name })
          .from(memberships)
          .innerJoin(membershipPlans, eq(memberships.planId, membershipPlans.id))
          .where(and(inArray(memberships.locationId, locationIds), isNull(memberships.deletedAt)))
          .orderBy(desc(memberships.endDate), asc(memberships.id));

  const contactRows = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.customerId, id), isNull(contacts.deletedAt)))
    .orderBy(desc(contacts.isPrimary), asc(contacts.name), asc(contacts.id));

  const invoiceRows = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.customerId, id), isNull(invoices.deletedAt)))
    .orderBy(desc(invoices.invoiceDate), desc(invoices.number))
    .limit(RECENT_INVOICE_LIMIT);

  const [balance] = await db
    .select({
      cents: sql<number>`coalesce(sum(${invoices.balanceCents}), 0)::bigint`.mapWith(toSafeInteger),
    })
    .from(invoices)
    .where(
      and(eq(invoices.customerId, id), eq(invoices.status, "open"), isNull(invoices.deletedAt)),
    );

  const toEquipment = (row: (typeof equipmentRows)[number]): EquipmentSummary => {
    const ageYears = row.installYear === null ? null : Math.max(0, asOfYear - row.installYear);
    return {
      id: row.id,
      kind: row.kind,
      brand: row.brand,
      model: row.model,
      serial: row.serial,
      installYear: row.installYear,
      ageYears,
      pastReplacementAge: ageYears !== null && ageYears > ageLimit,
      warrantyEnd: row.warrantyEnd,
      notes: row.notes,
    };
  };

  const hasBillTo = [
    customer.billStreet,
    customer.billStreet2,
    customer.billCity,
    customer.billState,
    customer.billZip,
  ].some((v) => v !== null && v !== "");

  return {
    id: customer.id,
    stId: customer.stId,
    type: customer.type,
    name: customer.name,
    email: customer.email,
    billTo: hasBillTo
      ? {
          street: customer.billStreet,
          street2: customer.billStreet2,
          city: customer.billCity,
          state: customer.billState,
          zip: customer.billZip,
        }
      : null,
    termsNetDays: customer.termsNetDays,
    poRequired: customer.poRequired,
    taxExempt: customer.taxExempt,
    notes: customer.notes,
    openBalanceCents: balance?.cents ?? 0,
    asOf,
    replacementAgeYears: ageLimit,
    locations: locationRows.map(({ location, unit }) => {
      const items = equipmentRows.filter((e) => e.locationId === location.id).map(toEquipment);
      return {
        id: location.id,
        stId: location.stId,
        name: location.name,
        street: location.street,
        street2: location.street2,
        city: location.city,
        state: location.state,
        zip: location.zip,
        lat: location.lat,
        lng: location.lng,
        accessNotes: location.accessNotes,
        defaultBusinessUnit: unit,
        replacementFlag: items.some((e) => e.pastReplacementAge),
        equipment: items,
        memberships: membershipRows
          .filter((m) => m.membership.locationId === location.id)
          .map(({ membership, planName }) => ({
            id: membership.id,
            planName,
            status: membership.status,
            startDate: membership.startDate,
            endDate: membership.endDate,
            visitsRemaining: membership.visitsRemaining,
            autoRenew: membership.autoRenew,
            priceCents: membership.priceCents,
          })),
      };
    }),
    contacts: contactRows.map((c) => ({
      id: c.id,
      locationId: c.locationId,
      name: c.name,
      phone: c.phone,
      altPhone: c.altPhone,
      email: c.email,
      textOptIn: c.textOptIn,
      isPrimary: c.isPrimary,
    })),
    recentInvoices: invoiceRows.map((inv) => ({
      id: inv.id,
      number: inv.number,
      origin: inv.origin,
      jobId: inv.jobId,
      locationId: inv.locationId,
      invoiceDate: inv.invoiceDate,
      dueDate: inv.dueDate,
      status: inv.status,
      billingStage: inv.billingStage,
      totalCents: inv.totalCents,
      balanceCents: inv.balanceCents,
      summary: inv.summary,
    })),
  };
}

/** bigint sums arrive as strings; money stays an exact integer or fails loudly. */
function toSafeInteger(value: unknown): number {
  const n = typeof value === "number" ? value : Number(String(value));
  if (!Number.isSafeInteger(n)) throw new RangeError(`Not a safe integer: ${String(value)}`);
  return n;
}
