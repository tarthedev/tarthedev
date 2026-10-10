import { auditLog, user } from "@dwrg/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  API_ORIGIN,
  call,
  errorOf,
  loginAs,
  setupTestApp,
  type TestApp,
  WEB_ORIGIN,
} from "./helpers";

let t: TestApp;
let cookie: string;

beforeAll(async () => {
  t = await setupTestApp();
  cookie = (await loginAs(t, { role: "owner" })).cookie;
});
afterAll(async () => {
  await t?.close();
});

const ROLE_MESSAGE = "Must be one of: owner, manager, dispatcher_csr, tech, installer";

describe("validation errors are 400 with field messages", () => {
  it("lists every missing field of a new login", async () => {
    const res = await call(t, "/api/employees", { cookie, json: {} });
    expect(res.status).toBe(400);
    const error = await errorOf(res);
    expect(error).toMatchObject({
      code: "validation_failed",
      message: "Check the highlighted fields.",
      requestId: res.headers.get("X-Request-Id"),
    });
    expect(error.fields).toEqual({
      name: ["Enter a name"],
      email: ["Enter an email address"],
      role: [ROLE_MESSAGE],
      password: ["Enter a password"],
    });
  });

  it("explains each bad field, including list items and unknown fields", async () => {
    const res = await call(t, "/api/employees", {
      cookie,
      json: {
        name: "   ",
        email: "not-an-email",
        role: "boss",
        password: "short",
        phone: "12",
        skills: ["hvac", "welding"],
        hiredOn: "2026-02-30",
        isAdmin: true,
      },
    });
    expect(res.status).toBe(400);
    expect((await errorOf(res)).fields).toEqual({
      name: ["Enter a name"],
      email: ["Enter a valid email address"],
      role: [ROLE_MESSAGE],
      password: ["Use at least 12 characters"],
      phone: ["Enter a 10-digit US phone number, or an international number starting with +"],
      "skills.1": ["Must be one of: hvac, plumbing, refrigeration, commercial"],
      hiredOn: ["Enter a real date like 2026-10-09"],
      isAdmin: ["Unknown field"],
    });
  });

  it("writes nothing when validation fails", async () => {
    const users = await t.db.select().from(user);
    const audits = await t.db.select().from(auditLog);
    await call(t, "/api/employees", {
      cookie,
      json: { name: "No Pass", email: "nopass@test.dwrg.example", role: "tech" },
    });
    expect(await t.db.select().from(user)).toHaveLength(users.length);
    expect(await t.db.select().from(auditLog)).toHaveLength(audits.length);
  });

  it("checks query strings the same way", async () => {
    const employees = await call(t, "/api/employees?role=boss&active=maybe", { cookie });
    expect(employees.status).toBe(400);
    expect(await errorOf(employees)).toMatchObject({
      message: "Check the search options.",
      fields: { role: [ROLE_MESSAGE], active: ["Must be true or false"] },
    });

    const pricebook = await call(
      t,
      `/api/pricebook?kind=widget&includeInactive=perhaps&q=${"x".repeat(101)}`,
      { cookie },
    );
    expect(pricebook.status).toBe(400);
    expect((await errorOf(pricebook)).fields).toEqual({
      q: ["Must be 100 characters or less"],
      kind: ["Must be one of: service, material, equipment"],
      includeInactive: ["Must be true or false"],
    });

    const customers = await call(t, "/api/customers?type=x&page=abc", { cookie });
    expect((await errorOf(customers)).fields).toEqual({
      page: ["Must be a whole number"],
      type: ["Must be one of: residential, commercial"],
    });
  });
});

describe("request bodies", () => {
  const post = (body: string, contentType: string, origin = WEB_ORIGIN) =>
    t.app.request(`${API_ORIGIN}/api/employees`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": contentType, Origin: origin },
      body,
    });

  it("must be JSON (415 otherwise)", async () => {
    const res = await call(t, "/api/employees", {
      cookie,
      json: { name: "x" },
      headers: { "Content-Type": "text/plain" },
    });
    expect(res.status).toBe(415);
    expect((await errorOf(res)).code).toBe("unsupported_media_type");
  });

  it("must be valid JSON (400)", async () => {
    const res = await post("{not json", "application/json");
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toMatchObject({
      code: "validation_failed",
      message: "The request body isn't valid JSON.",
    });
  });

  it("can't be larger than 1 MB (413)", async () => {
    const res = await post(JSON.stringify({ name: "x".repeat(1_100_000) }), "application/json");
    expect(res.status).toBe(413);
    expect((await errorOf(res)).code).toBe("payload_too_large");
  });

  it("can't come from another site's form (403)", async () => {
    const res = await post("name=x", "application/x-www-form-urlencoded", "https://evil.example");
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toMatchObject({
      code: "forbidden",
      message: "You don't have access to this.",
    });
  });
});
