import {
  auditLog,
  ST_IMPORT_METRICS as DB_ST_IMPORT_METRICS,
  ST_IMPORT_STATUSES as DB_ST_IMPORT_STATUSES,
  employees,
  pricebookItems,
  stImportBatches,
  stImportRows,
} from "@dwrg/db";
import {
  IMPORT_ISSUE_LIMIT,
  importBatchDetailSchema,
  importListResponseSchema,
  importPreviewResponseSchema,
  MAX_IMPORT_FILE_BYTES,
  ROLES,
  type Role,
  ST_IMPORT_METRICS,
  ST_IMPORT_STATUSES,
  ST_REPORT_LABELS,
  ST_REPORT_TYPES,
} from "@dwrg/shared";
import { MAPPINGS, REPORT_TYPES } from "@dwrg/st-import";
import { readDemoFixtures } from "@dwrg/st-import/demo";
import { count, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { silentLogger } from "../src/logger";
import {
  decodeCsv,
  type ImportFileStore,
  ROWS_ONLY_STORAGE_PREFIX,
  storageKeyFor,
} from "../src/routes/imports";
import {
  API_ORIGIN,
  bodyAs,
  call,
  errorOf,
  loginAs,
  setupTestApp,
  type TestApp,
  WEB_ORIGIN,
} from "./helpers";

const demo = readDemoFixtures();

let t: TestApp;
const cookies = {} as Record<Role, string>;
const userIds = {} as Record<Role, string>;

beforeAll(async () => {
  t = await setupTestApp();
  for (const role of ROLES) {
    const login = await loginAs(t, { role });
    cookies[role] = login.cookie;
    userIds[role] = login.id;
  }
});
afterAll(async () => {
  await t?.close();
});

/** A multipart upload, as the Import page sends it. */
function upload(
  path: string,
  init: {
    cookie: string;
    csv: string | Uint8Array<ArrayBuffer>;
    fileName?: string;
    fields?: Record<string, string>;
    origin?: string;
  },
): Promise<Response> {
  const form = new FormData();
  const bytes = typeof init.csv === "string" ? new TextEncoder().encode(init.csv) : init.csv;
  form.set("file", new File([bytes], init.fileName ?? "export.csv", { type: "text/csv" }));
  for (const [key, value] of Object.entries(init.fields ?? {})) form.set(key, value);
  return Promise.resolve(
    t.app.request(`${API_ORIGIN}${path}`, {
      method: "POST",
      headers: { Origin: init.origin ?? WEB_ORIGIN, Cookie: init.cookie },
      body: form,
    }),
  );
}

async function batchCount(): Promise<number> {
  const [row] = await t.db.select({ n: count() }).from(stImportBatches);
  return row?.n ?? 0;
}

const TECHNICIANS_HEADER =
  "Technician ID,Name,Email,Mobile Phone,Role,Business Units,Skills,Hire Date,Active";

describe("who can use the import endpoints", () => {
  const OFFICE: readonly Role[] = ["owner", "manager", "dispatcher_csr"];

  for (const role of ROLES) {
    const ok = OFFICE.includes(role);
    it(`${role} ${ok ? "can" : "can't"} list imports`, async () => {
      const res = await call(t, "/api/imports", { cookie: cookies[role] });
      expect(res.status).toBe(ok ? 200 : 403);
    });
  }

  it("refuses field roles before reading an upload, and writes nothing", async () => {
    for (const role of ["tech", "installer"] as const) {
      for (const path of ["/api/imports/preview", "/api/imports"]) {
        const res = await upload(path, { cookie: cookies[role], csv: demo.files.technicians });
        expect(res.status).toBe(403);
        expect((await errorOf(res)).code).toBe("forbidden");
      }
      const summary = await call(t, "/api/imports/00000000-0000-4000-8000-000000000000/summary", {
        cookie: cookies[role],
        json: { rows: [{ count: 1 }] },
      });
      expect(summary.status).toBe(403);
    }
    expect(await batchCount()).toBe(0);
  });

  it("needs a login", async () => {
    const res = await t.app.request(`${API_ORIGIN}/api/imports`, {
      headers: { Origin: WEB_ORIGIN },
    });
    expect(res.status).toBe(401);
  });

  it("refuses a cross-site form post", async () => {
    const res = await upload("/api/imports", {
      cookie: cookies.owner,
      csv: demo.files.technicians,
      origin: "https://evil.example",
    });
    expect(res.status).toBe(403);
    expect(await batchCount()).toBe(0);
  });
});

describe("POST /api/imports/preview", () => {
  it("detects the report, maps the columns and shows the first rows, writing nothing", async () => {
    const before = await t.db.select({ n: count() }).from(employees);
    const res = await upload("/api/imports/preview", {
      cookie: cookies.dispatcher_csr,
      csv: demo.files.technicians,
      fileName: "C:\\fakepath\\technicians.csv",
    });
    expect(res.status).toBe(200);
    const body = await bodyAs(importPreviewResponseSchema, res);
    expect(body).toMatchObject({
      reportType: "technicians",
      detectedReportType: "technicians",
      detectionNote: null,
      fileError: null,
      rowCount: 13,
      errors: [],
      errorCount: 0,
      rejectedRows: 0,
      missingColumns: [],
      headerRowNumber: 1,
    });
    expect(body.file.name).toBe("technicians.csv");
    expect(body.file.sizeBytes).toBe(new TextEncoder().encode(demo.files.technicians).byteLength);
    expect(body.file.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(body.candidates[0]?.reportType).toBe("technicians");
    expect(body.columns).toMatchObject({ technicianId: "Technician ID", email: "Email" });
    expect(body.rows).toHaveLength(13);
    expect(body.rows[0]).toMatchObject({ rowNumber: 2, stId: "DEMO-E-00001" });
    expect(body.rows[0]?.fields.name).toBe("Jeffrey Roberts");

    expect(await batchCount()).toBe(0);
    expect(await t.db.select({ n: count() }).from(employees)).toEqual(before);
  });

  it("takes the CSV as a text/csv body with options in the query string", async () => {
    const res = await t.app.request(`${API_ORIGIN}/api/imports/preview?reportType=pricebook`, {
      method: "POST",
      headers: { Origin: WEB_ORIGIN, Cookie: cookies.manager, "Content-Type": "text/csv" },
      body: demo.files.pricebook,
    });
    expect(res.status).toBe(200);
    const body = await bodyAs(importPreviewResponseSchema, res);
    expect(body.reportType).toBe("pricebook");
    expect(body.rowCount).toBe(66);
    expect(body.rows).toHaveLength(20);
    expect(body.file.name).toMatch(/^servicetitan-export-[0-9a-f]{8}\.csv$/);
  });

  it("lists row problems with spreadsheet row numbers", async () => {
    const csv = [
      TECHNICIANS_HEADER,
      "T-1,Pat Good,pat.good@test.dwrg.example,(252) 555-0101,Technician,HVAC Service,HVAC,1/2/2020,Yes",
      "T-2,Bad Date,bad.date@test.dwrg.example,(252) 555-0102,Technician,HVAC Service,HVAC,13/45/2020,Yes",
      "T-3,No Role,no.role@test.dwrg.example,(252) 555-0103,Wizard,HVAC Service,HVAC,1/2/2020,Yes",
    ].join("\n");
    const res = await upload("/api/imports/preview", { cookie: cookies.owner, csv });
    expect(res.status).toBe(200);
    const body = await bodyAs(importPreviewResponseSchema, res);
    expect(body.rejectedRows).toBe(2);
    expect(body.errorCount).toBe(body.errors.length);
    expect(body.errors.map((e) => e.rowNumber)).toEqual([3, 4]);
    expect(body.errors[0]?.column).toBe("Hire Date");
  });

  it("says why it can't tell the report type, and offers every type", async () => {
    const res = await upload("/api/imports/preview", {
      cookie: cookies.owner,
      csv: "Favorite Color,Shoe Size\nblue,10\n",
    });
    const body = await bodyAs(importPreviewResponseSchema, res);
    expect(body.reportType).toBeNull();
    expect(body.fileError).toMatch(/don't match any ServiceTitan report/);
    expect(body.detectionNote).toBe(body.fileError);
    expect(body.candidates.map((c) => c.reportType).sort()).toEqual([...ST_REPORT_TYPES].sort());
  });

  it("names the missing columns when the report type is picked by hand", async () => {
    const res = await upload("/api/imports/preview", {
      cookie: cookies.owner,
      csv: demo.files.technicians,
      fields: { reportType: "payments" },
    });
    const body = await bodyAs(importPreviewResponseSchema, res);
    expect(body.reportType).toBe("payments");
    expect(body.fileError).toMatch(/payments report needs/);
    expect(body.missingColumns.length).toBeGreaterThan(0);
  });

  it("treats a blank report type as 'detect it'", async () => {
    const res = await upload("/api/imports/preview", {
      cookie: cookies.owner,
      csv: demo.files.technicians,
      fields: { reportType: "" },
    });
    expect((await bodyAs(importPreviewResponseSchema, res)).reportType).toBe("technicians");
  });

  it("caps the listed problems but counts them all", async () => {
    const rows = Array.from(
      { length: IMPORT_ISSUE_LIMIT + 5 },
      (_, i) => `T-${i},Name ${i},x${i}@test.dwrg.example,,Technician,,,not a date,Yes`,
    );
    const res = await upload("/api/imports/preview", {
      cookie: cookies.owner,
      csv: [TECHNICIANS_HEADER, ...rows].join("\n"),
    });
    const body = await bodyAs(importPreviewResponseSchema, res);
    expect(body.errors).toHaveLength(IMPORT_ISSUE_LIMIT);
    expect(body.errorCount).toBeGreaterThan(IMPORT_ISSUE_LIMIT);
  });

  it("takes files over the 1 MB JSON limit", async () => {
    // Blank lines don't count as rows.
    const big = demo.files.pricebook.padEnd(2 * 1024 * 1024, "\n");
    const res = await upload("/api/imports/preview", { cookie: cookies.owner, csv: big });
    expect(res.status).toBe(200);
    expect((await bodyAs(importPreviewResponseSchema, res)).rowCount).toBe(66);
  });
});

describe("refused uploads", () => {
  it("413 over the file limit", async () => {
    const res = await upload("/api/imports/preview", {
      cookie: cookies.owner,
      csv: new Uint8Array(MAX_IMPORT_FILE_BYTES + 1).fill(0x41),
    });
    expect(res.status).toBe(413);
    const error = await errorOf(res);
    expect(error.code).toBe("payload_too_large");
    expect(error.message).toMatch(/25 MB/);
  });

  it("413 for a text body over the limit", async () => {
    const res = await t.app.request(`${API_ORIGIN}/api/imports/preview`, {
      method: "POST",
      headers: { Origin: WEB_ORIGIN, Cookie: cookies.owner, "Content-Type": "text/csv" },
      body: "A,B\n".padEnd(MAX_IMPORT_FILE_BYTES + 100, "x"),
    });
    expect(res.status).toBe(413);
  });

  it("400 for an Excel workbook, with what to do instead", async () => {
    const res = await upload("/api/imports/preview", {
      cookie: cookies.owner,
      csv: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]),
      fileName: "invoices.xlsx",
    });
    expect(res.status).toBe(400);
    const error = await errorOf(res);
    expect(error.fields?.file).toEqual([
      "This is an Excel workbook. In ServiceTitan, export the report as CSV.",
    ]);
  });

  it("400 for an empty file, or no file at all", async () => {
    const empty = await upload("/api/imports/preview", { cookie: cookies.owner, csv: "" });
    expect(empty.status).toBe(400);
    expect((await errorOf(empty)).fields?.file).toEqual(["The file is empty"]);

    const form = new FormData();
    form.set("reportType", "pricebook");
    const none = await t.app.request(`${API_ORIGIN}/api/imports/preview`, {
      method: "POST",
      headers: { Origin: WEB_ORIGIN, Cookie: cookies.owner },
      body: form,
    });
    expect(none.status).toBe(400);
    expect((await errorOf(none)).fields?.file).toEqual(["Choose a CSV file"]);
  });

  it("400 for an unknown report type or option", async () => {
    const res = await upload("/api/imports/preview", {
      cookie: cookies.owner,
      csv: demo.files.technicians,
      fields: { reportType: "vehicles", color: "blue" },
    });
    expect(res.status).toBe(400);
    const error = await errorOf(res);
    expect(error.fields?.reportType?.[0]).toMatch(/^Must be one of: technicians, pricebook/);
    expect(error.fields?.color).toEqual(["Unknown field"]);
  });

  it("415 for a JSON body", async () => {
    const res = await call(t, "/api/imports/preview", {
      cookie: cookies.owner,
      json: { csv: "a,b" },
    });
    expect(res.status).toBe(415);
  });
});

describe("POST /api/imports", () => {
  let pricebookBatchId: string;

  it("imports a file, records who did it, and returns the import report", async () => {
    const res = await upload("/api/imports", {
      cookie: cookies.manager,
      csv: demo.files.technicians,
      fileName: "technicians.csv",
    });
    expect(res.status).toBe(201);
    const body = await bodyAs(importBatchDetailSchema, res);
    expect(body).toMatchObject({
      reportType: "technicians",
      fileName: "technicians.csv",
      status: "imported",
      rowsRead: 13,
      rejected: 0,
      error: null,
      uploadedBy: { id: userIds.manager, name: "Test manager" },
      errors: [],
      errorCount: 0,
      summary: { entered: false, matches: false },
    });
    expect(body.inserted + body.updated).toBe(13);
    expect(body.totals).toEqual([
      {
        businessUnitCode: "none",
        year: 0,
        metric: "count",
        ours: 13,
        servicetitanSummary: null,
        diff: null,
        note: null,
        status: "not_in_summary",
      },
    ]);
    expect(body.totalsMeaning).toEqual({ count: "technicians", dollars: null });
    expect(body.storageKey.startsWith(ROWS_ONLY_STORAGE_PREFIX)).toBe(true);

    // Every write is audited with the person who uploaded and a reason naming the batch.
    const audits = await t.db
      .select({ userId: auditLog.userId, reason: auditLog.reason })
      .from(auditLog)
      .where(sql`${auditLog.reason} like ${`%(batch ${body.id})%`}`);
    expect(audits.length).toBeGreaterThan(0);
    expect(audits.every((a) => a.userId === userIds.manager)).toBe(true);
  });

  it("imports with the report type and checksum the preview showed", async () => {
    const preview = await bodyAs(
      importPreviewResponseSchema,
      await upload("/api/imports/preview", { cookie: cookies.owner, csv: demo.files.pricebook }),
    );
    const res = await upload("/api/imports", {
      cookie: cookies.owner,
      csv: demo.files.pricebook,
      fileName: "pricebook.csv",
      fields: { reportType: "pricebook", sha256: preview.file.sha256 },
    });
    expect(res.status).toBe(201);
    const body = await bodyAs(importBatchDetailSchema, res);
    pricebookBatchId = body.id;
    expect(body).toMatchObject({ reportType: "pricebook", status: "imported", inserted: 66 });
    expect(body.fileSha256).toBe(preview.file.sha256);
    expect(body.storageKey).toBe(storageKeyFor(preview.file.sha256, false));
    const [items] = await t.db.select({ n: count() }).from(pricebookItems);
    expect(items?.n).toBe(66);
  });

  it("is idempotent: the same file again changes nothing", async () => {
    const res = await upload("/api/imports", {
      cookie: cookies.dispatcher_csr,
      csv: demo.files.pricebook,
      fileName: "pricebook.csv",
    });
    const body = await bodyAs(importBatchDetailSchema, res);
    expect(body).toMatchObject({ status: "imported", inserted: 0, updated: 0, unchanged: 66 });
    const [items] = await t.db.select({ n: count() }).from(pricebookItems);
    expect(items?.n).toBe(66);
  });

  it("refuses a file that isn't the one previewed (409), writing nothing", async () => {
    const before = await batchCount();
    const res = await upload("/api/imports", {
      cookie: cookies.owner,
      csv: demo.files.pricebook,
      fields: { sha256: "0".repeat(64) },
    });
    expect(res.status).toBe(409);
    expect((await errorOf(res)).message).toMatch(/isn't the one you previewed/);
    expect(await batchCount()).toBe(before);
  });

  it("records a file with the wrong columns as a failed upload", async () => {
    const res = await upload("/api/imports", {
      cookie: cookies.owner,
      csv: demo.files.technicians,
      fields: { reportType: "payments" },
    });
    expect(res.status).toBe(201);
    const body = await bodyAs(importBatchDetailSchema, res);
    expect(body.status).toBe("failed");
    expect(body.error).toMatch(/payments report needs/);
    expect(body.inserted + body.updated + body.unchanged).toBe(0);
  });

  it("keeps rejected rows with their reasons in the report", async () => {
    const csv = [
      TECHNICIANS_HEADER,
      "T-9,Bad Date,bad.date9@test.dwrg.example,(252) 555-0109,Technician,HVAC Service,HVAC,13/45/2020,Yes",
    ].join("\n");
    const body = await bodyAs(
      importBatchDetailSchema,
      await upload("/api/imports", { cookie: cookies.owner, csv }),
    );
    expect(body).toMatchObject({ status: "imported", rejected: 1, errorCount: 1 });
    expect(body.errors[0]).toMatchObject({ rowNumber: 2, column: null });
    expect(body.errors[0]?.message).toMatch(/date/i);
    const [raw] = await t.db
      .select({ payload: stImportRows.payload, result: stImportRows.result })
      .from(stImportRows)
      .where(eq(stImportRows.batchId, body.id));
    expect(raw?.result).toBe("rejected");
    expect(raw?.payload).toMatchObject({ "Hire Date": "13/45/2020" });
  });

  it("lists uploads newest first, and filters by report type", async () => {
    const res = await call(t, "/api/imports?pageSize=2", { cookie: cookies.dispatcher_csr });
    const list = await bodyAs(importListResponseSchema, res);
    expect(list.total).toBe(await batchCount());
    expect(list.items).toHaveLength(2);
    const [a, b] = list.items;
    expect(Date.parse(a?.uploadedAt ?? "")).toBeGreaterThanOrEqual(Date.parse(b?.uploadedAt ?? ""));

    const pricebook = await bodyAs(
      importListResponseSchema,
      await call(t, "/api/imports?reportType=pricebook", { cookie: cookies.owner }),
    );
    expect(pricebook.total).toBe(2);
    expect(pricebook.items.every((i) => i.reportType === "pricebook")).toBe(true);

    const bad = await call(t, "/api/imports?reportType=boats", { cookie: cookies.owner });
    expect(bad.status).toBe(400);
  });

  it("shows one upload's report, or 404", async () => {
    const res = await call(t, `/api/imports/${pricebookBatchId}`, { cookie: cookies.owner });
    const body = await bodyAs(importBatchDetailSchema, res);
    expect(body.id).toBe(pricebookBatchId);
    expect(body.totals.find((r) => r.metric === "count")?.ours).toBe(66);

    const missing = await call(t, "/api/imports/00000000-0000-4000-8000-000000000000", {
      cookie: cookies.owner,
    });
    expect(missing.status).toBe(404);
    const notUuid = await call(t, "/api/imports/abc", { cookie: cookies.owner });
    expect(notUuid.status).toBe(400);
  });

  describe("ServiceTitan's summary totals", () => {
    it("matches the demo summary", async () => {
      const rows = demo.summary.reports.pricebook;
      const res = await call(t, `/api/imports/${pricebookBatchId}/summary`, {
        cookie: cookies.owner,
        json: { rows },
      });
      expect(res.status).toBe(200);
      const body = await bodyAs(importBatchDetailSchema, res);
      expect(body.summary).toEqual({ entered: true, matches: true });
      expect(body.totals[0]).toMatchObject({
        ours: 66,
        servicetitanSummary: 66,
        diff: 0,
        status: "match",
      });
    });

    it("shows a difference, and replaces the summary entered before", async () => {
      const res = await call(t, `/api/imports/${pricebookBatchId}/summary`, {
        cookie: cookies.dispatcher_csr,
        json: { rows: [{ count: 70 }] },
      });
      const body = await bodyAs(importBatchDetailSchema, res);
      expect(body.summary).toEqual({ entered: true, matches: false });
      expect(body.totals[0]).toMatchObject({
        servicetitanSummary: 70,
        diff: -4,
        status: "differs",
      });
    });

    it("reads dollars as ServiceTitan shows them, into cents", async () => {
      const res = await call(t, `/api/imports/${pricebookBatchId}/summary`, {
        cookie: cookies.owner,
        json: {
          rows: [{ count: 66, businessUnit: "HVAC Service", year: 2025, total: "$1,234.56" }],
        },
      });
      const body = await bodyAs(importBatchDetailSchema, res);
      const line = body.totals.find((r) => r.businessUnitCode === "hvac_service");
      expect(body.totals.filter((r) => r.businessUnitCode === "hvac_service")).toHaveLength(2);
      expect(
        body.totals.find((r) => r.businessUnitCode === "hvac_service" && r.metric === "dollars"),
      ).toMatchObject({ ours: 0, servicetitanSummary: 123456, diff: -123456 });
      expect(line?.note).toBe("Not in this import");
      expect(body.summary.matches).toBe(false);
    });

    it("400 for a business unit or amount it can't read", async () => {
      const unknown = await call(t, `/api/imports/${pricebookBatchId}/summary`, {
        cookie: cookies.owner,
        json: { rows: [{ businessUnit: "Pool Cleaning", count: 1 }] },
      });
      expect(unknown.status).toBe(400);
      expect((await errorOf(unknown)).message).toMatch(/business unit we don't know/);

      const money = await call(t, `/api/imports/${pricebookBatchId}/summary`, {
        cookie: cookies.owner,
        json: { rows: [{ total: "about twelve dollars" }] },
      });
      expect(money.status).toBe(400);

      const empty = await call(t, `/api/imports/${pricebookBatchId}/summary`, {
        cookie: cookies.owner,
        json: { rows: [] },
      });
      expect(empty.status).toBe(400);
      expect((await errorOf(empty)).fields?.rows).toEqual(["Enter at least one line"]);
    });

    it("409 for a failed upload, 404 for none", async () => {
      const [failed] = await t.db
        .select({ id: stImportBatches.id })
        .from(stImportBatches)
        .where(eq(stImportBatches.status, "failed"));
      if (!failed) throw new Error("expected a failed batch from an earlier test");
      const res = await call(t, `/api/imports/${failed.id}/summary`, {
        cookie: cookies.owner,
        json: { rows: [{ count: 1 }] },
      });
      expect(res.status).toBe(409);
      const none = await call(t, "/api/imports/00000000-0000-4000-8000-000000000000/summary", {
        cookie: cookies.owner,
        json: { rows: [{ count: 1 }] },
      });
      expect(none.status).toBe(404);
    });
  });

  it("an unexpected failure is a generic 500; the cause and batch go to the log only", async () => {
    await t.db.execute(sql`
      create function test_refuse_pricebook() returns trigger language plpgsql as $$
      begin raise exception 'disk on fire' using errcode = 'XX000'; end $$;
    `);
    await t.db.execute(sql`
      create trigger test_refuse_pricebook before update or insert on pricebook_items
      for each row execute function test_refuse_pricebook();
    `);
    try {
      const csv = demo.files.pricebook.replace("HVAC diagnostic / service call", "Diagnostic");
      const res = await upload("/api/imports", { cookie: cookies.owner, csv });
      expect(res.status).toBe(500);
      const error = await errorOf(res);
      expect(error.code).toBe("internal");
      expect(error.message).not.toMatch(/disk on fire/);
      const line = t.logs.find(
        (l) => l.requestId === res.headers.get("X-Request-Id") && l.msg === "import failed",
      );
      expect(line?.batchId).toEqual(expect.any(String));
      expect(JSON.stringify(line)).toMatch(/disk on fire/);
    } finally {
      await t.db.execute(sql`drop trigger test_refuse_pricebook on pricebook_items`);
      await t.db.execute(sql`drop function test_refuse_pricebook()`);
    }
  });
});

describe("keeping the raw file", () => {
  it("stores the exact bytes under the sha256 key when a file store is set", async () => {
    const saved: { key: string; bytes: Uint8Array; contentType: string }[] = [];
    const fileStore: ImportFileStore = {
      put: async (key, bytes, contentType) => {
        saved.push({ key, bytes, contentType });
      },
    };
    const app = createApp({
      db: t.db,
      auth: t.auth,
      env: t.env,
      logger: silentLogger,
      importFileStore: fileStore,
    });
    const bytes = new TextEncoder().encode(`\uFEFF${demo.files.technicians}`);
    const form = new FormData();
    form.set("file", new File([bytes], "technicians.csv", { type: "text/csv" }));
    const res = await app.request(`${API_ORIGIN}/api/imports`, {
      method: "POST",
      headers: { Origin: WEB_ORIGIN, Cookie: cookies.owner },
      body: form,
    });
    expect(res.status).toBe(201);
    const body = await bodyAs(importBatchDetailSchema, res);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.key).toBe(body.storageKey);
    expect(body.storageKey).toBe(`st-imports/${body.fileSha256}.csv`);
    expect(Buffer.from(saved[0]?.bytes ?? []).equals(Buffer.from(bytes))).toBe(true);
    expect(saved[0]?.contentType).toBe("text/csv");
    expect(body.rejected).toBe(0);
  });
});

describe("decodeCsv", () => {
  it("keeps a UTF-8 byte-order mark for the CSV reader", () => {
    expect(decodeCsv(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]))).toBe("\uFEFFA");
  });

  it("reads Windows-1252 (Excel on Windows) when the file isn't UTF-8", () => {
    expect(decodeCsv(new Uint8Array([0x4a, 0x6f, 0x73, 0xe9]))).toBe("José");
  });

  it("reads UTF-16 with a byte-order mark", () => {
    expect(decodeCsv(new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0x2c, 0x00]))).toBe("A,");
  });
});

describe("value lists match the importer and the database", () => {
  it("report types and their labels", () => {
    expect([...ST_REPORT_TYPES]).toEqual([...REPORT_TYPES]);
    for (const type of REPORT_TYPES) expect(ST_REPORT_LABELS[type]).toBe(MAPPINGS[type].label);
  });

  it("statuses and metrics", () => {
    expect([...ST_IMPORT_STATUSES]).toEqual([...DB_ST_IMPORT_STATUSES]);
    expect([...ST_IMPORT_METRICS]).toEqual([...DB_ST_IMPORT_METRICS]);
  });
});
