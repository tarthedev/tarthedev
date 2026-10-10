import { type BusinessUnitCode, type CustomerType, contacts, customers, locations } from "@dwrg/db";
import { rowResult } from "../context";
import { customersMapping } from "../mappings/customers";
import { BUSINESS_UNIT_NAMES, CUSTOMER_TYPE_NAMES } from "../mappings/values";
import type { RowReader } from "../reader";
import { type Claim, defineHandler } from "./types";

type CustomerField = keyof typeof customersMapping.fields;

export interface CustomerPart {
  stId: string;
  type: CustomerType;
  name: string;
  email: string | null | undefined;
  billStreet: string | null | undefined;
  billStreet2: string | null | undefined;
  billCity: string | null | undefined;
  billState: string | null | undefined;
  billZip: string | null | undefined;
  termsNetDays: number | undefined;
  poRequired: boolean | undefined;
  taxExempt: boolean | undefined;
  notes: string | null | undefined;
}

export interface LocationPart {
  stId: string;
  name: string | null | undefined;
  street: string;
  street2: string | null | undefined;
  city: string;
  state: string | undefined;
  zip: string;
  lat: number | null | undefined;
  lng: number | null | undefined;
  accessNotes: string | null | undefined;
  defaultBusinessUnit: BusinessUnitCode | null | undefined;
}

export interface ContactPart {
  stId: string;
  name: string;
  phone: string | null | undefined;
  altPhone: string | null | undefined;
  email: string | null | undefined;
  textOptIn: boolean | undefined;
  isPrimary: boolean | undefined;
}

export interface CustomerRow {
  customer: CustomerPart;
  location: LocationPart | null;
  contact: ContactPart | null;
}

/** "Net 30" -> 30; "Due Upon Receipt" -> 0. */
function parseTerms(value: string): number | null {
  const text = value.trim().toLowerCase();
  if (
    /^(due\s+(up)?on\s+receipt|upon\s+receipt|on\s+receipt|cod|c\.o\.d\.|immediate)$/.test(text)
  ) {
    return 0;
  }
  const net = /^(?:net\s*)?(\d{1,3})(?:\s*days?)?$/.exec(text);
  return net ? Number(net[1]) : null;
}

function readCustomer(r: RowReader<CustomerField>): CustomerPart {
  const terms = r.convert("paymentTerms", parseTerms, "is not payment terms like Net 30");
  const poRequired = r.bool("poRequired");
  const taxExempt = r.bool("taxExempt");
  return {
    stId: r.requiredId("customerId"),
    type: r.requiredChoice("customerType", CUSTOMER_TYPE_NAMES, "residential"),
    name: r.requiredText("customerName"),
    email: r.email("customerEmail"),
    billStreet: r.text("billingStreet"),
    billStreet2: r.text("billingStreet2"),
    billCity: r.text("billingCity"),
    billState: r.text("billingState"),
    billZip: r.text("billingZip"),
    termsNetDays: terms === null ? 0 : terms,
    poRequired: poRequired === null ? false : poRequired,
    taxExempt: taxExempt === null ? false : taxExempt,
    notes: r.text("customerNotes"),
  };
}

function readLocation(r: RowReader<CustomerField>, stId: string): LocationPart {
  const state = r.text("locationState");
  return {
    stId,
    name: r.text("locationName"),
    street: r.requiredText("locationStreet"),
    street2: r.text("locationStreet2"),
    city: r.requiredText("locationCity"),
    // Blank takes the column default (NC).
    state: state ?? undefined,
    zip: r.requiredText("locationZip"),
    lat: r.coordinate("latitude", 90),
    lng: r.coordinate("longitude", 180),
    accessNotes: r.text("accessNotes"),
    defaultBusinessUnit: r.choice("defaultBusinessUnit", BUSINESS_UNIT_NAMES),
  };
}

function readContact(r: RowReader<CustomerField>, stId: string): ContactPart {
  const textOptIn = r.bool("textOptIn");
  const isPrimary = r.bool("primaryContact");
  return {
    stId,
    name: r.requiredText("contactName"),
    phone: r.phone("contactPhone"),
    altPhone: r.phone("contactAltPhone"),
    email: r.email("contactEmail"),
    textOptIn: textOptIn === null ? false : textOptIn,
    isPrimary: isPrimary === null ? false : isPrimary,
  };
}

/**
 * Customers with their locations and contacts. A contact on a row with a
 * Location ID belongs to that location; otherwise to the customer.
 */
export const customersHandler = defineHandler({
  mapping: customersMapping,

  parse(r): CustomerRow {
    const customer = readCustomer(r);
    const locationId = r.id("locationId");
    const contactId = r.id("contactId");
    return {
      customer,
      location: locationId ? readLocation(r, locationId) : null,
      contact: contactId ? readContact(r, contactId) : null,
    };
  },

  stIdOf: (row) => row.contact?.stId ?? row.location?.stId ?? row.customer.stId,

  claims(row) {
    const claims: Claim[] = [
      {
        key: `customers:${row.customer.stId}`,
        label: `Customer ${row.customer.stId}`,
        details: { ...row.customer },
      },
    ];
    if (row.location) {
      claims.push({
        key: `locations:${row.location.stId}`,
        label: `Location ${row.location.stId}`,
        details: { customer: row.customer.stId, ...row.location },
      });
    }
    if (row.contact) {
      claims.push({
        key: `contacts:${row.contact.stId}`,
        label: `Contact ${row.contact.stId}`,
        details: {
          customer: row.customer.stId,
          location: row.location?.stId ?? null,
          ...row.contact,
        },
      });
    }
    return claims;
  },

  businessUnits: (row) =>
    row.location?.defaultBusinessUnit ? [row.location.defaultBusinessUnit] : [],

  async load(lookups) {
    await lookups.loadBusinessUnits();
  },

  check(lookups, row) {
    if (row.location?.defaultBusinessUnit) lookups.businessUnit(row.location.defaultBusinessUnit);
  },

  async importGroup(scope, rows) {
    const [parsed] = rows;
    if (!parsed) return [];
    const { customer, location, contact } = parsed.value;
    const { lookups } = scope;

    // Resolve everything before writing anything.
    const bu = location?.defaultBusinessUnit;
    const defaultBusinessUnitId = bu === undefined || bu === null ? bu : lookups.businessUnit(bu);

    const c = await scope.upsert(customers, customers.stId, customer.stId, { ...customer });
    let l: { id: string; result: "inserted" | "updated" | "unchanged" } | null = null;
    if (location) {
      const { defaultBusinessUnit: _code, ...fields } = location;
      l = await scope.upsert(locations, locations.stId, location.stId, {
        ...fields,
        customerId: c.id,
        defaultBusinessUnitId,
      });
    }
    let ct: { id: string; result: "inserted" | "updated" | "unchanged" } | null = null;
    if (contact) {
      ct = await scope.upsert(contacts, contacts.stId, contact.stId, {
        ...contact,
        customerId: c.id,
        locationId: l?.id ?? null,
      });
    }

    scope.onCommit(() => {
      lookups.customers.set(customer.stId, c.id);
      if (location && l) lookups.locations.set(location.stId, { id: l.id, customerId: c.id });
    });
    const primary = ct ?? l ?? c;
    return [
      {
        rowNumber: parsed.rowNumber,
        result: rowResult(primary.result, [c.result, l?.result, ct?.result]),
        stId: contact?.stId ?? location?.stId ?? customer.stId,
        targetTable: ct ? "contacts" : l ? "locations" : "customers",
        targetId: primary.id,
        error: null,
      },
    ];
  },
});
