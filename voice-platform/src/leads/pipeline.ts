import { parse } from "csv-parse/sync";
import { config } from "../config.js";
import { getLead, isDnc, logEvent, updateLead, upsertLead, type Lead } from "../db.js";
import { toE164 } from "../lib/util.js";
import { lookupLineType } from "../tools/twilio.js";
import { auditWebsite } from "./audit.js";
import { searchPlaces } from "./places.js";
import { scoreLead } from "./score.js";

/** Run async work over items with a small concurrency limit. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Audit the website, look up the phone line type, and score. Safe to run again. */
export async function enrichLead(id: number, opts: { lookup?: boolean } = {}): Promise<Lead | undefined> {
  const lead = getLead(id);
  if (!lead) return;
  const audit = await auditWebsite(lead.website);
  const patch: Partial<Lead> = { audit_json: JSON.stringify(audit), website_status: audit.status };
  if ((opts.lookup ?? true) && lead.phone && !lead.line_type && config.TWILIO_ACCOUNT_SID) {
    try {
      const info = await lookupLineType(lead.phone);
      patch.line_type = info.type;
      patch.carrier = info.carrier;
    } catch (err) {
      console.error(`[leads] lookup failed for ${lead.phone}:`, (err as Error).message);
    }
  }
  const scored = scoreLead({ ...lead, ...patch } as Lead);
  patch.score = scored.score;
  if (!lead.pitch) patch.pitch = scored.pitch;
  if (lead.phone && isDnc(lead.phone)) patch.status = "dnc";
  updateLead(id, patch);
  return getLead(id);
}

export interface FindResult {
  found: number;
  added: number;
  skippedClosed: number;
  skippedNoPhone: number;
  leadIds: number[];
}

/** Find businesses on Google, save them as leads, and enrich each one. */
export async function findLeads(query: string, max = 60): Promise<FindResult> {
  const places = await searchPlaces(query, max);
  const result: FindResult = { found: places.length, added: 0, skippedClosed: 0, skippedNoPhone: 0, leadIds: [] };
  const ids: number[] = [];
  for (const p of places) {
    if (!p.operational) {
      result.skippedClosed++;
      continue;
    }
    if (!p.lead.phone) {
      result.skippedNoPhone++;
      continue;
    }
    const { id, created } = upsertLead({ ...p.lead, timezone: config.TIMEZONE });
    if (created) result.added++;
    ids.push(id);
  }
  await mapLimit(ids, 4, (id) => enrichLead(id));
  result.leadIds = ids;
  logEvent({ type: "leads_found", data: { query, ...result, leadIds: undefined } });
  return result;
}

const HEADER_ALIASES: Record<string, string> = {
  name: "business_name",
  business: "business_name",
  "business name": "business_name",
  company: "business_name",
  phone: "phone",
  "phone number": "phone",
  telephone: "phone",
  website: "website",
  url: "website",
  site: "website",
  category: "category",
  industry: "category",
  type: "category",
  city: "city",
  state: "state",
  address: "address",
  email: "email",
  contact: "contact_name",
  "contact name": "contact_name",
  owner: "contact_name",
  rating: "rating",
  reviews: "review_count",
  "review count": "review_count",
};

/** Import leads from a CSV export (Outscraper, Apify, a spreadsheet...). Needs at least a name and phone column. */
export async function importCsv(text: string): Promise<{ added: number; updated: number; skipped: number; leadIds: number[] }> {
  const rows = parse(text, { columns: true, skip_empty_lines: true, trim: true, bom: true }) as Record<string, string>[];
  let added = 0;
  let updated = 0;
  let skipped = 0;
  const ids: number[] = [];
  for (const row of rows) {
    const rec: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) {
      const key = HEADER_ALIASES[k.toLowerCase().trim()];
      if (key && v) rec[key] = v;
    }
    const phone = toE164(rec.phone);
    if (!rec.business_name || !phone) {
      skipped++;
      continue;
    }
    const { id, created } = upsertLead({
      business_name: rec.business_name,
      phone,
      website: rec.website || null,
      category: rec.category || null,
      city: rec.city || null,
      state: rec.state || null,
      address: rec.address || null,
      email: rec.email || null,
      contact_name: rec.contact_name || null,
      rating: rec.rating ? Number(rec.rating) : null,
      review_count: rec.review_count ? Number(rec.review_count) : null,
      timezone: config.TIMEZONE,
      source: "csv",
    });
    created ? added++ : updated++;
    ids.push(id);
  }
  await mapLimit(ids, 4, (id) => enrichLead(id));
  return { added, updated, skipped, leadIds: ids };
}
