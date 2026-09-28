import type { Config } from "../config.js";
import type { Lead } from "../db.js";
import { hhmmToMinutes, localTime } from "../lib/util.js";

// The rules every automated AI call must pass. See docs/COMPLIANCE.md for why each one exists.
//
// Federal law (TCPA, 47 U.S.C. 227(b)) treats AI-generated voices as "artificial voice" (FCC ruling,
// Feb 2024). Calling a cell phone, or a residential line, with an artificial voice requires the
// person's prior express consent (written consent for sales calls). Business landlines are outside
// those two restrictions, so by default the AI only cold-calls business landlines and fixed VoIP
// lines. Everything else goes to the manual list for a person to dial.

export type BlockCode =
  | "no_phone"
  | "dnc"
  | "closed"
  | "line_type_unknown"
  | "needs_consent"
  | "max_attempts"
  | "called_today"
  | "scheduled"
  | "too_soon"
  | "hours"
  | "day";

export type GateResult =
  | { ok: true; basis: "consent" | "business_landline" }
  | { ok: false; code: BlockCode; reason: string; manual?: boolean; retryAt?: Date };

/** Legal outer bounds for any sales call: 8am to 9pm in the called party's local time (TCPA + N.C.G.S. 75-102). */
const LEGAL_START = 8 * 60;
const LEGAL_END = 21 * 60;

export interface GateInput {
  lead: Lead;
  now: Date;
  cfg: Pick<
    Config,
    | "CALL_WINDOW_START"
    | "CALL_WINDOW_END"
    | "CALL_DAYS"
    | "WEB_LEAD_WINDOW_START"
    | "WEB_LEAD_WINDOW_END"
    | "MAX_ATTEMPTS"
    | "RETRY_GAP_HOURS"
    | "AI_COLD_CALL_LINE_TYPES"
    | "TIMEZONE"
  >;
  onDnc: (phone: string) => boolean;
  /** Calls already placed to this lead today (local), including ones in progress. */
  callsToday?: number;
}

export function hasAiCallConsent(lead: Pick<Lead, "consent_json">): boolean {
  if (!lead.consent_json) return false;
  try {
    const c = JSON.parse(lead.consent_json) as { ai_calls?: boolean; revoked_at?: string };
    return c.ai_calls === true && !c.revoked_at;
  } catch {
    return false;
  }
}

export function checkAutoDial({ lead, now, cfg, onDnc, callsToday = 0 }: GateInput): GateResult {
  if (!lead.phone) return { ok: false, code: "no_phone", reason: "no phone number" };
  if (lead.status === "dnc" || onDnc(lead.phone)) return { ok: false, code: "dnc", reason: "on the do-not-call list" };
  if (lead.status === "won" || lead.status === "lost") return { ok: false, code: "closed", reason: `lead is ${lead.status}` };

  const consent = hasAiCallConsent(lead);
  if (!consent) {
    if (!lead.line_type) return { ok: false, code: "line_type_unknown", reason: "phone line type not checked yet" };
    if (!cfg.AI_COLD_CALL_LINE_TYPES.includes(lead.line_type)) {
      return {
        ok: false,
        code: "needs_consent",
        manual: true,
        reason: `${lead.line_type} number: the AI can only call it with written consent; call it yourself`,
      };
    }
  }

  if (lead.attempts >= cfg.MAX_ATTEMPTS && lead.status !== "callback") {
    return { ok: false, code: "max_attempts", reason: `already tried ${lead.attempts} times` };
  }
  if (callsToday > 0) return { ok: false, code: "called_today", reason: "already called today" };
  if (lead.next_attempt_at && new Date(lead.next_attempt_at) > now) {
    return { ok: false, code: "scheduled", reason: "waiting for scheduled time", retryAt: new Date(lead.next_attempt_at) };
  }
  if (lead.last_attempt_at && lead.status !== "callback") {
    const gapMs = cfg.RETRY_GAP_HOURS * 3600_000;
    const since = now.getTime() - new Date(lead.last_attempt_at).getTime();
    if (since < gapMs) {
      return { ok: false, code: "too_soon", reason: "too soon since the last attempt", retryAt: new Date(new Date(lead.last_attempt_at).getTime() + gapMs) };
    }
  }

  const tz = lead.timezone || cfg.TIMEZONE;
  const t = localTime(now, tz);
  const [start, end] = consent
    ? [hhmmToMinutes(cfg.WEB_LEAD_WINDOW_START), hhmmToMinutes(cfg.WEB_LEAD_WINDOW_END)]
    : [hhmmToMinutes(cfg.CALL_WINDOW_START), hhmmToMinutes(cfg.CALL_WINDOW_END)];
  const from = Math.max(start, LEGAL_START);
  const to = Math.min(end, LEGAL_END);
  if (t.minutes < from || t.minutes >= to) return { ok: false, code: "hours", reason: `outside calling hours in ${tz}` };
  // People who asked us to call them can hear back any day of the week; cold calls stick to business days.
  if (!consent && !cfg.CALL_DAYS.includes(String(t.weekday))) return { ok: false, code: "day", reason: "not a calling day" };
  if (t.weekday === 0 && !consent) return { ok: false, code: "day", reason: "no cold calls on Sunday" };

  return { ok: true, basis: consent ? "consent" : "business_landline" };
}
