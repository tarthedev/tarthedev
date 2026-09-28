import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

export type LineType =
  | "landline"
  | "mobile"
  | "fixedVoip"
  | "nonFixedVoip"
  | "personal"
  | "tollFree"
  | "premium"
  | "sharedCost"
  | "uan"
  | "voicemail"
  | "pager"
  | "unknown";

export type LeadStatus =
  | "new" // found, not called yet
  | "contacted" // spoke to someone, no decision
  | "interested" // wants to see more / demo sent
  | "callback" // asked to be called at a specific time
  | "won"
  | "lost"
  | "dnc"; // asked not to be called

export interface Lead {
  id: number;
  place_id: string | null;
  business_name: string;
  category: string | null;
  phone: string | null;
  mobile: string | null; // a cell the owner gave us on a call, for texts
  email: string | null;
  contact_name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  website: string | null;
  rating: number | null;
  review_count: number | null;
  maps_url: string | null;
  hours_json: string | null;
  reviews_json: string | null;
  timezone: string | null;
  source: "places" | "csv" | "web" | "manual";
  line_type: LineType | null;
  carrier: string | null;
  audit_json: string | null;
  website_status: "none" | "social_only" | "broken" | "outdated" | "ok" | null;
  score: number;
  pitch: "website" | "receptionist" | "both" | null;
  status: LeadStatus;
  consent_json: string | null;
  preview_slug: string | null;
  preview_json: string | null;
  preview_views: number;
  preview_last_viewed_at: string | null;
  attempts: number;
  last_attempt_at: string | null;
  next_attempt_at: string | null;
  notes: string | null;
  is_client: number;
  created_at: string;
  updated_at: string;
}

export interface Tenant {
  id: number;
  slug: string;
  business_name: string;
  phone_number: string | null;
  owner_name: string | null;
  owner_cell: string | null;
  owner_email: string | null;
  timezone: string;
  agent_name: string;
  voice: string | null;
  greeting: string | null;
  knowledge: string;
  transfer_rules: string | null;
  calcom_api_key: string | null;
  calcom_event_type_id: number | null;
  booking_url: string | null;
  plan: "addon" | "solo";
  minutes_included: number;
  active: number;
  lead_id: number | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CallRow {
  id: number;
  call_sid: string;
  direction: "inbound" | "outbound";
  kind: "receptionist" | "sales" | "demo" | "voicemail";
  tenant_id: number | null;
  lead_id: number | null;
  from_number: string | null;
  to_number: string | null;
  status: string | null;
  answered_by: string | null;
  outcome: string | null;
  summary: string | null;
  transcript_json: string | null;
  duration_sec: number | null;
  recording_url: string | null;
  started_at: string;
  ended_at: string | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY,
  place_id TEXT UNIQUE,
  business_name TEXT NOT NULL,
  category TEXT,
  phone TEXT,
  mobile TEXT,
  email TEXT,
  contact_name TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  website TEXT,
  rating REAL,
  review_count INTEGER,
  maps_url TEXT,
  hours_json TEXT,
  reviews_json TEXT,
  timezone TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  line_type TEXT,
  carrier TEXT,
  audit_json TEXT,
  website_status TEXT,
  score INTEGER NOT NULL DEFAULT 0,
  pitch TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  consent_json TEXT,
  preview_slug TEXT UNIQUE,
  preview_json TEXT,
  preview_views INTEGER NOT NULL DEFAULT 0,
  preview_last_viewed_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  next_attempt_at TEXT,
  notes TEXT,
  is_client INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS leads_phone ON leads(phone);
CREATE INDEX IF NOT EXISTS leads_mobile ON leads(mobile);
CREATE INDEX IF NOT EXISTS leads_status ON leads(status, score);

CREATE TABLE IF NOT EXISTS dnc (
  phone TEXT PRIMARY KEY,
  reason TEXT,
  source TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS tenants (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  business_name TEXT NOT NULL,
  phone_number TEXT UNIQUE,
  owner_name TEXT,
  owner_cell TEXT,
  owner_email TEXT,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  agent_name TEXT NOT NULL DEFAULT 'Sam',
  voice TEXT,
  greeting TEXT,
  knowledge TEXT NOT NULL DEFAULT '',
  transfer_rules TEXT,
  calcom_api_key TEXT,
  calcom_event_type_id INTEGER,
  booking_url TEXT,
  plan TEXT NOT NULL DEFAULT 'solo',
  minutes_included INTEGER NOT NULL DEFAULT 500,
  active INTEGER NOT NULL DEFAULT 0,
  lead_id INTEGER,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS calls (
  id INTEGER PRIMARY KEY,
  call_sid TEXT NOT NULL UNIQUE,
  direction TEXT NOT NULL,
  kind TEXT NOT NULL,
  tenant_id INTEGER,
  lead_id INTEGER,
  from_number TEXT,
  to_number TEXT,
  status TEXT,
  answered_by TEXT,
  outcome TEXT,
  summary TEXT,
  transcript_json TEXT,
  duration_sec INTEGER,
  recording_url TEXT,
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ended_at TEXT
);
CREATE INDEX IF NOT EXISTS calls_lead ON calls(lead_id);
CREATE INDEX IF NOT EXISTS calls_tenant ON calls(tenant_id, started_at);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  lead_id INTEGER,
  tenant_id INTEGER,
  call_sid TEXT,
  type TEXT NOT NULL,
  data_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS events_lead ON events(lead_id, created_at);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  const file = process.env.DB_FILE ?? path.join(config.DATA_DIR, "rollinson.db");
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

/** Test helper: swap in a fresh in-memory database. */
export function resetDbForTests(): Database.Database {
  db?.close();
  db = new Database(":memory:");
  db.exec(SCHEMA);
  return db;
}

export const nowIso = () => new Date().toISOString();

// ---------- leads ----------

export function getLead(id: number): Lead | undefined {
  return getDb().prepare("SELECT * FROM leads WHERE id = ?").get(id) as Lead | undefined;
}

export function findLeadByPhone(phone: string): Lead | undefined {
  return getDb()
    .prepare("SELECT * FROM leads WHERE phone = ? OR mobile = ? ORDER BY updated_at DESC LIMIT 1")
    .get(phone, phone) as Lead | undefined;
}

export function findLeadBySlug(slug: string): Lead | undefined {
  return getDb().prepare("SELECT * FROM leads WHERE preview_slug = ?").get(slug) as Lead | undefined;
}

export type LeadInsert = Partial<Omit<Lead, "id" | "created_at" | "updated_at">> & { business_name: string };

/** Insert a lead, or update the existing one with the same Google place id / phone. Returns the id. */
export function upsertLead(input: LeadInsert): { id: number; created: boolean } {
  const d = getDb();
  const existing =
    (input.place_id
      ? (d.prepare("SELECT id FROM leads WHERE place_id = ?").get(input.place_id) as { id: number } | undefined)
      : undefined) ??
    (input.phone
      ? (d.prepare("SELECT id FROM leads WHERE phone = ?").get(input.phone) as { id: number } | undefined)
      : undefined);
  if (existing) {
    updateLead(existing.id, input);
    return { id: existing.id, created: false };
  }
  const keys = Object.keys(input).filter((k) => (input as Record<string, unknown>)[k] !== undefined);
  const sql = `INSERT INTO leads (${keys.join(",")}) VALUES (${keys.map((k) => "@" + k).join(",")})`;
  const info = d.prepare(sql).run(input);
  return { id: Number(info.lastInsertRowid), created: true };
}

const LEAD_COLUMNS = new Set([
  "place_id", "business_name", "category", "phone", "mobile", "email", "contact_name", "address", "city",
  "state", "website", "rating", "review_count", "maps_url", "hours_json", "reviews_json", "timezone", "source",
  "line_type", "carrier", "audit_json", "website_status", "score", "pitch", "status", "consent_json",
  "preview_slug", "preview_json", "preview_views", "preview_last_viewed_at", "attempts", "last_attempt_at",
  "next_attempt_at", "notes", "is_client",
]);

export function updateLead(id: number, patch: Partial<Lead>): void {
  const keys = Object.keys(patch).filter(
    (k) => LEAD_COLUMNS.has(k) && (patch as Record<string, unknown>)[k] !== undefined,
  );
  if (!keys.length) return;
  const sql = `UPDATE leads SET ${keys.map((k) => `${k} = @${k}`).join(", ")}, updated_at = @__now WHERE id = @__id`;
  getDb().prepare(sql).run({ ...pick(patch, keys), __now: nowIso(), __id: id });
}

function pick(o: object, keys: string[]) {
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = (o as Record<string, unknown>)[k];
  return out;
}

export function appendLeadNote(id: number, note: string): void {
  const lead = getLead(id);
  if (!lead) return;
  const stamp = new Date().toLocaleString("en-US", { timeZone: config.TIMEZONE });
  const notes = [lead.notes, `[${stamp}] ${note}`].filter(Boolean).join("\n");
  updateLead(id, { notes });
}

export function listLeads(opts: { status?: string; q?: string; limit?: number; offset?: number } = {}): Lead[] {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (opts.status) {
    where.push("status = @status");
    params.status = opts.status;
  }
  if (opts.q) {
    where.push("(business_name LIKE @q OR category LIKE @q OR city LIKE @q OR phone LIKE @q)");
    params.q = `%${opts.q}%`;
  }
  const sql = `SELECT * FROM leads ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY score DESC, id DESC LIMIT @limit OFFSET @offset`;
  return getDb()
    .prepare(sql)
    .all({ ...params, limit: opts.limit ?? 100, offset: opts.offset ?? 0 }) as Lead[];
}

// ---------- DNC ----------

export function isDnc(phone: string): boolean {
  return Boolean(getDb().prepare("SELECT 1 FROM dnc WHERE phone = ?").get(phone));
}

export function addDnc(phone: string, reason: string, source: string): void {
  getDb()
    .prepare("INSERT INTO dnc (phone, reason, source) VALUES (?, ?, ?) ON CONFLICT(phone) DO NOTHING")
    .run(phone, reason, source);
  getDb()
    .prepare("UPDATE leads SET status = 'dnc', updated_at = ? WHERE phone = ? OR mobile = ?")
    .run(nowIso(), phone, phone);
}

// ---------- tenants ----------

export function getTenant(id: number): Tenant | undefined {
  return getDb().prepare("SELECT * FROM tenants WHERE id = ?").get(id) as Tenant | undefined;
}

export function getTenantByNumber(phone: string): Tenant | undefined {
  return getDb().prepare("SELECT * FROM tenants WHERE phone_number = ?").get(phone) as Tenant | undefined;
}

export function listTenants(): Tenant[] {
  return getDb().prepare("SELECT * FROM tenants ORDER BY business_name").all() as Tenant[];
}

const TENANT_COLUMNS = new Set([
  "slug", "business_name", "phone_number", "owner_name", "owner_cell", "owner_email", "timezone", "agent_name",
  "voice", "greeting", "knowledge", "transfer_rules", "calcom_api_key", "calcom_event_type_id", "booking_url",
  "plan", "minutes_included", "active", "lead_id", "stripe_customer_id", "stripe_subscription_id",
]);

export function saveTenant(t: Partial<Tenant> & { business_name: string }, id?: number): number {
  const keys = Object.keys(t).filter((k) => TENANT_COLUMNS.has(k) && (t as Record<string, unknown>)[k] !== undefined);
  const d = getDb();
  if (id) {
    d.prepare(`UPDATE tenants SET ${keys.map((k) => `${k} = @${k}`).join(", ")}, updated_at = @__now WHERE id = @__id`).run(
      { ...pick(t, keys), __now: nowIso(), __id: id },
    );
    return id;
  }
  const info = d
    .prepare(`INSERT INTO tenants (${keys.join(",")}) VALUES (${keys.map((k) => "@" + k).join(",")})`)
    .run(pick(t, keys));
  return Number(info.lastInsertRowid);
}

export function tenantMinutesThisMonth(tenantId: number): number {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const row = getDb()
    .prepare("SELECT COALESCE(SUM(duration_sec),0) AS s FROM calls WHERE tenant_id = ? AND started_at >= ?")
    .get(tenantId, start.toISOString()) as { s: number };
  return Math.ceil(row.s / 60);
}

// ---------- calls & events ----------

export function upsertCall(c: Partial<CallRow> & { call_sid: string }): void {
  const d = getDb();
  const existing = d.prepare("SELECT id FROM calls WHERE call_sid = ?").get(c.call_sid);
  const keys = Object.keys(c).filter((k) => k !== "id" && (c as Record<string, unknown>)[k] !== undefined);
  if (existing) {
    const sets = keys.filter((k) => k !== "call_sid");
    if (!sets.length) return;
    d.prepare(`UPDATE calls SET ${sets.map((k) => `${k} = @${k}`).join(", ")} WHERE call_sid = @call_sid`).run(
      pick(c, keys),
    );
  } else {
    d.prepare(`INSERT INTO calls (${keys.join(",")}) VALUES (${keys.map((k) => "@" + k).join(",")})`).run(pick(c, keys));
  }
}

export function getCall(callSid: string): CallRow | undefined {
  return getDb().prepare("SELECT * FROM calls WHERE call_sid = ?").get(callSid) as CallRow | undefined;
}

export function listCalls(opts: { leadId?: number; tenantId?: number; limit?: number } = {}): CallRow[] {
  if (opts.leadId)
    return getDb().prepare("SELECT * FROM calls WHERE lead_id = ? ORDER BY id DESC").all(opts.leadId) as CallRow[];
  if (opts.tenantId)
    return getDb()
      .prepare("SELECT * FROM calls WHERE tenant_id = ? ORDER BY id DESC LIMIT ?")
      .all(opts.tenantId, opts.limit ?? 100) as CallRow[];
  return getDb().prepare("SELECT * FROM calls ORDER BY id DESC LIMIT ?").all(opts.limit ?? 100) as CallRow[];
}

export function logEvent(e: {
  type: string;
  leadId?: number | null;
  tenantId?: number | null;
  callSid?: string | null;
  data?: unknown;
}): void {
  getDb()
    .prepare("INSERT INTO events (lead_id, tenant_id, call_sid, type, data_json) VALUES (?, ?, ?, ?, ?)")
    .run(e.leadId ?? null, e.tenantId ?? null, e.callSid ?? null, e.type, e.data === undefined ? null : JSON.stringify(e.data));
}

export interface EventRow {
  id: number;
  lead_id: number | null;
  tenant_id: number | null;
  call_sid: string | null;
  type: string;
  data_json: string | null;
  created_at: string;
}

export function listEvents(opts: { leadId?: number; limit?: number } = {}): EventRow[] {
  if (opts.leadId)
    return getDb().prepare("SELECT * FROM events WHERE lead_id = ? ORDER BY id DESC LIMIT ?").all(opts.leadId, opts.limit ?? 200) as EventRow[];
  return getDb().prepare("SELECT * FROM events ORDER BY id DESC LIMIT ?").all(opts.limit ?? 200) as EventRow[];
}

// ---------- settings (runtime toggles) ----------

export function getSetting(key: string): string | undefined {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, value);
}
