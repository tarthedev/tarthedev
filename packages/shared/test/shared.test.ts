import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  canAssignRole,
  createEmployeeRequestSchema,
  customerSearchQuerySchema,
  employeeListQuerySchema,
  fieldErrorsFrom,
  isOfficeRole,
  normalizePhone,
  pricebookQuerySchema,
  ROLES,
} from "../src";

describe("normalizePhone", () => {
  it.each([
    ["(252) 555-0123", "+12525550123"],
    ["252.555.0123", "+12525550123"],
    ["252-555-0123", "+12525550123"],
    ["1 252 555 0123", "+12525550123"],
    ["+1 (252) 555-0123", "+12525550123"],
    ["+44 20 7946 0958", "+442079460958"],
  ])("%s -> %s", (input, phone) => {
    expect(normalizePhone(input)).toBe(phone);
  });

  it.each(["555-0123", "052 555 0123", "2 252 555 0123", "call me", "", "+0123456789"])(
    "rejects %j",
    (input) => {
      expect(normalizePhone(input)).toBeUndefined();
    },
  );
});

describe("fieldErrorsFrom", () => {
  it("groups messages by dotted path and names unknown fields", () => {
    const schema = z.strictObject({ a: z.string(), list: z.array(z.int()) });
    const result = schema.safeParse({ a: 1, list: [1, "x"], extra: true, more: 1 });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(fieldErrorsFrom(result.error)).toEqual({
      a: ["Invalid input: expected string, received number"],
      "list.1": ["Invalid input: expected number, received string"],
      extra: ["Unknown field"],
      more: ["Unknown field"],
    });
  });
});

describe("roles", () => {
  it("owners can create any role; managers anything but owner; others nothing", () => {
    for (const target of ROLES) {
      expect(canAssignRole("owner", target)).toBe(true);
      expect(canAssignRole("manager", target)).toBe(target !== "owner");
      for (const actor of ["dispatcher_csr", "tech", "installer"] as const) {
        expect(canAssignRole(actor, target)).toBe(false);
      }
    }
  });

  it("office roles are owner, manager and dispatcher/CSR", () => {
    expect(ROLES.filter(isOfficeRole)).toEqual(["owner", "manager", "dispatcher_csr"]);
  });
});

describe("createEmployeeRequestSchema", () => {
  it("trims, lower-cases, normalizes the phone and de-duplicates lists", () => {
    expect(
      createEmployeeRequestSchema.parse({
        name: "  Pat  Smith ",
        email: " Pat@Example.COM ",
        role: "tech",
        password: "twelve-chars",
        phone: "(252) 555-0101",
        skills: ["hvac", "hvac", "plumbing"],
      }),
    ).toEqual({
      name: "Pat  Smith",
      email: "pat@example.com",
      role: "tech",
      password: "twelve-chars",
      phone: "+12525550101",
      skills: ["hvac", "plumbing"],
      businessUnits: [],
    });
  });

  it("keeps the password exactly as typed", () => {
    const parsed = createEmployeeRequestSchema.parse({
      name: "A",
      email: "a@example.com",
      role: "tech",
      password: "  spaced out  ",
    });
    expect(parsed.password).toBe("  spaced out  ");
  });
});

describe("query schemas", () => {
  it("coerce paging and clean up search text", () => {
    expect(customerSearchQuerySchema.parse({ q: "  Main   St ", page: "2" })).toEqual({
      q: "Main St",
      page: 2,
      pageSize: 25,
    });
    expect(customerSearchQuerySchema.parse({ q: "   " })).toEqual({ page: 1, pageSize: 25 });
  });

  it("read booleans from query strings", () => {
    expect(employeeListQuerySchema.parse({ active: "false" })).toEqual({ active: false });
    expect(pricebookQuerySchema.parse({}).includeInactive).toBe(false);
    expect(pricebookQuerySchema.parse({ includeInactive: "true" }).includeInactive).toBe(true);
  });
});
