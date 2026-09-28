import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditWebsite, isSocialOnly } from "../src/leads/audit.js";

const filler = "<p>" + "We fix roofs in Elizabeth City. ".repeat(30) + "</p>";
const pages: Record<string, [number, string]> = {
  "/good": [200, `<html><head><title>Albemarle Roofing</title><meta name="viewport" content="width=device-width"></head><body>${filler}<a href="tel:+12525550199">Call</a> © 2026</body></html>`],
  "/old": [200, `<html><head><title>Old Site</title></head><body>${filler}Copyright 2014</body></html>`],
  "/parked": [200, `<html><body>${filler}This domain is for sale! Buy this domain today.</body></html>`],
  "/error": [500, "oops"],
};

let server: http.Server;
let base = "";

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const [status, body] = pages[req.url ?? ""] ?? [404, "not found"];
    res.writeHead(status, { "content-type": "text/html" }).end(body);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

describe("website audit", () => {
  it("flags a missing website", async () => {
    expect((await auditWebsite(null)).status).toBe("none");
  });
  it("flags social and directory pages", async () => {
    expect((await auditWebsite("https://www.facebook.com/albemarleroofing")).status).toBe("social_only");
    expect(isSocialOnly("https://sites.google.com/view/roofing")).toBe(false);
  });
  it("flags broken and parked sites", async () => {
    expect((await auditWebsite(`${base}/error`)).status).toBe("broken");
    expect((await auditWebsite(`${base}/parked`)).status).toBe("broken");
    expect((await auditWebsite("http://127.0.0.1:1/nothing-listens-here", 2000)).status).toBe("broken");
  });
  it("flags insecure, non-mobile, unmaintained sites with specific reasons", async () => {
    const a = await auditWebsite(`${base}/old`);
    expect(a.status).toBe("outdated");
    expect(a.issues.join(" ")).toMatch(/isn't secure/);
    expect(a.issues.join(" ")).toMatch(/built for phones/);
    expect(a.issues.join(" ")).toMatch(/2014/);
  });
  it("passes a decent site (the only issue is plain http on the local test server)", async () => {
    const a = await auditWebsite(`${base}/good`);
    expect(a.issues).toEqual(["The site isn't secure (browsers show a 'Not secure' warning)"]);
  });
});
