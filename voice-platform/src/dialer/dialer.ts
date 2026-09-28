import { config } from "../config.js";
import { getDb, getLead, getSetting, isDnc, logEvent, nowIso, updateLead, type Lead } from "../db.js";
import { hhmmToMinutes, localTime, zonedToUtc } from "../lib/util.js";
import { ensurePreview } from "../preview/generate.js";
import { activeCalls } from "../relay/calls.js";
import { twilioClient } from "../tools/twilio.js";
import { checkAutoDial, hasAiCallConsent, type GateResult } from "./compliance.js";

function consentNumber(lead: Lead): string | null {
  try {
    return (JSON.parse(lead.consent_json ?? "{}") as { phone?: string }).phone ?? null;
  } catch {
    return null;
  }
}

function calledToday(lead: Lead, now = new Date()): number {
  if (!lead.last_attempt_at) return 0;
  const tz = lead.timezone || config.TIMEZONE;
  return localTime(new Date(lead.last_attempt_at), tz).dateKey === localTime(now, tz).dateKey ? 1 : 0;
}

export function gateFor(lead: Lead, now = new Date()): GateResult {
  return checkAutoDial({ lead, now, cfg: config, onDnc: isDnc, callsToday: calledToday(lead, now) });
}

export function dialerRunning(): boolean {
  return config.DIALER_ENABLED && getSetting("dialer_paused") !== "1";
}

function outboundCallsToday(): number {
  const start = zonedToUtc(`${localTime(new Date(), config.TIMEZONE).dateKey}T00:00`, config.TIMEZONE)!;
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM calls WHERE direction = 'outbound' AND kind = 'sales' AND started_at >= ?")
    .get(start.toISOString()) as { n: number };
  return row.n;
}

/** Place one AI sales call. Every call passes the compliance gate first; there is no override. */
export async function placeSalesCall(leadId: number): Promise<{ ok: boolean; message: string; callSid?: string }> {
  const lead = getLead(leadId);
  if (!lead) return { ok: false, message: "Lead not found" };
  const gate = gateFor(lead);
  if (!gate.ok) return { ok: false, message: `Not calling: ${gate.reason}` };
  if (!config.SALES_CALLER_ID) return { ok: false, message: "SALES_CALLER_ID is not set" };
  // Consent covers the number the person typed into the form, so that's the one we ring.
  const to = (gate.basis === "consent" && consentNumber(lead)) || lead.phone!;
  if (isDnc(to)) return { ok: false, message: "Not calling: on the do-not-call list" };

  // Have the preview ready before we pitch it.
  if (lead.pitch !== "receptionist" && !lead.preview_slug) {
    try {
      await ensurePreview(lead.id);
    } catch (e) {
      console.error(`[dialer] preview for lead ${lead.id} failed; calling anyway`, (e as Error).message);
    }
  }

  const base = config.PUBLIC_BASE_URL.replace(/\/$/, "");
  const call = await twilioClient().calls.create({
    to,
    from: config.SALES_CALLER_ID,
    url: `${base}/twilio/voice/outbound?leadId=${lead.id}`,
    method: "POST",
    statusCallback: `${base}/twilio/status`,
    statusCallbackMethod: "POST",
    statusCallbackEvent: ["answered", "completed"],
    machineDetection: "DetectMessageEnd",
    asyncAmd: "true",
    asyncAmdStatusCallback: `${base}/twilio/amd`,
    asyncAmdStatusCallbackMethod: "POST",
    timeout: 25,
    record: config.RECORD_SALES_CALLS,
    ...(config.RECORD_SALES_CALLS
      ? { recordingStatusCallback: `${base}/twilio/recording`, recordingChannels: "dual" }
      : {}),
  });
  updateLead(lead.id, {
    attempts: lead.attempts + 1,
    last_attempt_at: nowIso(),
    next_attempt_at: null,
    status: lead.status === "callback" ? "contacted" : lead.status,
  });
  getDb()
    .prepare(
      "INSERT INTO calls (call_sid, direction, kind, lead_id, from_number, to_number, status) VALUES (?, 'outbound', 'sales', ?, ?, ?, 'queued') ON CONFLICT(call_sid) DO NOTHING",
    )
    .run(call.sid, lead.id, config.SALES_CALLER_ID, to);
  logEvent({ type: "call_placed", leadId: lead.id, callSid: call.sid, data: { basis: gate.basis } });
  return { ok: true, message: `Calling ${lead.business_name}`, callSid: call.sid };
}

/** Next leads the dialer would call, best first. */
export function dialQueue(limit = 25): { lead: Lead; gate: GateResult }[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM leads WHERE status IN ('new','contacted','callback') AND phone IS NOT NULL
       ORDER BY (status = 'callback') DESC, (consent_json IS NOT NULL) DESC, score DESC, id ASC LIMIT 400`,
    )
    .all() as Lead[];
  const now = new Date();
  return rows.map((lead) => ({ lead, gate: gateFor(lead, now) })).slice(0, Math.max(limit, 0) || rows.length);
}

/** Leads the AI isn't allowed to cold-call (cell phones and the like): Aaron dials these by hand. */
export function manualQueue(limit = 100): Lead[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM leads WHERE status IN ('new','contacted','callback') AND phone IS NOT NULL AND consent_json IS NULL
       AND line_type IS NOT NULL AND line_type NOT IN (${config.AI_COLD_CALL_LINE_TYPES.map(() => "?").join(",") || "''"})
       ORDER BY score DESC LIMIT ?`,
    )
    .all(...config.AI_COLD_CALL_LINE_TYPES, limit) as Lead[];
  return rows.filter((l) => !isDnc(l.phone!));
}

let ticking = false;

/** Called every minute: place the next call if there's room. */
export async function dialerTick(): Promise<void> {
  if (ticking || !dialerRunning()) return;
  ticking = true;
  try {
    const live = activeCalls().filter((c) => c.kind === "sales" && c.direction === "outbound" && !c.finalized).length;
    // Calls still ringing. Ignore stale rows so one lost status callback can't stall the dialer.
    const pending = getDb()
      .prepare(
        "SELECT COUNT(*) AS n FROM calls WHERE direction='outbound' AND status IN ('queued','ringing','initiated') AND started_at > ?",
      )
      .get(new Date(Date.now() - 10 * 60_000).toISOString()) as { n: number };
    if (live + pending.n >= config.MAX_CONCURRENT_CALLS) return;
    if (outboundCallsToday() >= config.DAILY_CALL_CAP) return;
    const next = dialQueue(400).find((q) => q.gate.ok);
    if (!next) return;
    const r = await placeSalesCall(next.lead.id);
    if (!r.ok) console.warn(`[dialer] ${r.message}`);
  } catch (err) {
    console.error("[dialer] tick failed", err);
  } finally {
    ticking = false;
  }
}

/** When the next consent-based calling window opens for a lead. */
export function nextWebLeadWindow(lead: Lead, from = new Date()): Date {
  const tz = lead.timezone || config.TIMEZONE;
  const startMin = Math.max(hhmmToMinutes(config.WEB_LEAD_WINDOW_START), 8 * 60);
  for (let d = 0; d < 8; d++) {
    const day = new Date(from.getTime() + d * 86400_000);
    const key = localTime(day, tz).dateKey;
    const hh = String(Math.floor(startMin / 60)).padStart(2, "0");
    const mm = String(startMin % 60).padStart(2, "0");
    const at = zonedToUtc(`${key}T${hh}:${mm}`, tz)!;
    if (at > from) return at;
  }
  return new Date(from.getTime() + 86400_000);
}

/** Someone filled out the website form asking for a call: call within seconds if we're allowed to. */
export async function callWebLeadNow(leadId: number): Promise<{ calling: boolean; message: string }> {
  const lead = getLead(leadId);
  if (!lead) return { calling: false, message: "not found" };
  if (!hasAiCallConsent(lead)) return { calling: false, message: "no consent to call" };
  const gate = gateFor(lead);
  if (gate.ok && config.SALES_CALLER_ID && config.TWILIO_ACCOUNT_SID) {
    const r = await placeSalesCall(lead.id);
    return { calling: r.ok, message: r.message };
  }
  if (!gate.ok && gate.code !== "hours" && gate.code !== "day") {
    return { calling: false, message: `${config.OWNER_FIRST_NAME} will reach out shortly` };
  }
  const at = nextWebLeadWindow(lead);
  updateLead(lead.id, { next_attempt_at: at.toISOString(), status: "callback" });
  return {
    calling: false,
    message: `We'll call at ${at.toLocaleString("en-US", { timeZone: lead.timezone || config.TIMEZONE, weekday: "long", hour: "numeric", minute: "2-digit" })}`,
  };
}

export function startDialer(): NodeJS.Timeout {
  return setInterval(() => void dialerTick(), 60_000);
}
