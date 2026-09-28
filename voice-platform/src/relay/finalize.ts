import { z } from "zod";
import { config, publicUrl } from "../config.js";
import {
  appendLeadNote,
  getCall,
  getLead,
  getSetting,
  getTenant,
  logEvent,
  nowIso,
  setSetting,
  tenantMinutesThisMonth,
  updateLead,
  upsertCall,
  type LeadStatus,
} from "../db.js";
import { generateStructured } from "../llm.js";
import { formatPhone } from "../offer.js";
import { notifyAaron, notifyOwner } from "../tools/notify.js";
import { dropCallState, getCallState } from "./calls.js";
import type { CallState } from "./types.js";

const OUTCOME_STATUS: Record<string, LeadStatus> = {
  interested: "interested",
  sale_link_sent: "interested",
  meeting_booked: "interested",
  callback: "callback",
  gatekeeper: "contacted",
  no_decision: "contacted",
  not_interested: "lost",
  wrong_number: "lost",
  dnc: "dnc",
};

const HOT = new Set(["interested", "sale_link_sent", "meeting_booked", "callback"]);

const SummarySchema = z.object({
  summary: z.string().describe("2-3 sentences: who called, what they wanted, what happened"),
  caller_name: z.string().describe("Caller's name if they gave it, else empty"),
  needs_callback: z.boolean(),
});

async function summarize(call: CallState): Promise<z.infer<typeof SummarySchema> | null> {
  const lines = call.transcript.filter((l) => l.who !== "system");
  if (!lines.some((l) => l.who === "caller") || !config.ANTHROPIC_API_KEY) return null;
  try {
    return await generateStructured({
      schema: SummarySchema,
      system: "You summarize phone calls for a busy small-business owner. Be brief and concrete. Include any details the caller gave (address, timing, problem).",
      prompt: lines.map((l) => `${l.who === "caller" ? "Caller" : "AI"}: ${l.text}`).join("\n"),
      maxTokens: 2000,
      effort: "low",
    });
  } catch (e) {
    console.error("[finalize] summary failed", (e as Error).message);
    return null;
  }
}

/** Runs when Twilio reports the call is over: record it, update the lead, tell the owner. */
export async function finalizeCall(callSid: string, info: { status: string; durationSec?: number; answeredBy?: string }) {
  const state = getCallState(callSid);
  const row = getCall(callSid);
  upsertCall({
    call_sid: callSid,
    status: info.status,
    duration_sec: info.durationSec ?? null,
    ended_at: nowIso(),
    ...(info.answeredBy ? { answered_by: info.answeredBy } : {}),
  });

  if (!state) {
    // Never reached the AI: no answer, busy, failed, or voicemail only.
    if (row?.lead_id && row.direction === "outbound") {
      const what = row.answered_by?.startsWith("machine") ? "left voicemail" : info.status;
      appendLeadNote(row.lead_id, `Call attempt: ${what}.`);
      if (row.answered_by?.startsWith("machine")) upsertCall({ call_sid: callSid, outcome: "voicemail" });
    }
    return;
  }
  if (state.finalized) return;
  state.finalized = true;

  const auto = state.summary ? null : await summarize(state);
  const summary = state.summary ?? auto?.summary ?? null;
  upsertCall({
    call_sid: callSid,
    outcome: state.outcome ?? (state.answeredBy?.startsWith("machine") ? "voicemail" : null),
    summary,
    transcript_json: JSON.stringify(state.transcript),
  });

  const minutes = Math.max(1, Math.ceil((info.durationSec ?? 0) / 60));
  const caller = state.direction === "inbound" ? state.from : state.to;

  if (state.kind === "receptionist" && state.tenantId) {
    const tenant = getTenant(state.tenantId);
    if (tenant && !state.messageTaken && summary) {
      await notifyOwner({
        cell: tenant.owner_cell,
        email: tenant.owner_email,
        sms: `📞 Call from ${auto?.caller_name || formatPhone(caller)} (${formatPhone(caller)}): ${summary}`,
        subject: `Call summary: ${auto?.caller_name || formatPhone(caller)}`,
        body: `${summary}\n\nCaller: ${formatPhone(caller)}\n\nTranscript:\n${state.transcript
          .filter((l) => l.who !== "system")
          .map((l) => `${l.who === "caller" ? "Caller" : tenant.agent_name}: ${l.text}`)
          .join("\n")}`,
        smsFrom: tenant.phone_number,
      });
    }
    if (tenant) {
      const used = tenantMinutesThisMonth(tenant.id);
      const key = `minutes_alert:${tenant.id}:${new Date().toISOString().slice(0, 7)}`;
      if (used > tenant.minutes_included && !getSetting(key)) {
        setSetting(key, "1");
        void notifyAaron(`⏱ ${tenant.business_name} is at ${used} of ${tenant.minutes_included} receptionist minutes this month.`);
      }
    }
  }

  if ((state.kind === "sales" || state.kind === "demo") && state.leadId) {
    const lead = getLead(state.leadId);
    const status = state.outcome ? OUTCOME_STATUS[state.outcome] : undefined;
    if (lead && status && lead.status !== "won" && lead.status !== "dnc") updateLead(lead.id, { status });
    if (summary) appendLeadNote(state.leadId, `${state.kind === "demo" ? "Demo line" : "Call"} (${minutes} min, ${state.outcome ?? "ended"}): ${summary}`);
    if (lead && state.outcome && HOT.has(state.outcome)) {
      void notifyAaron(
        `🔥 ${lead.business_name}: ${state.outcome.replace(/_/g, " ")}. ${summary ?? ""} ${publicUrl(`/admin/leads/${lead.id}`)}`,
      );
    }
    if (state.kind === "demo" && state.direction === "inbound" && lead) {
      void notifyAaron(`🎧 ${lead.business_name} called the receptionist demo line (${minutes} min). ${summary ?? ""}`);
    }
  }
  logEvent({ type: "call_finished", leadId: state.leadId, tenantId: state.tenantId, callSid, data: { outcome: state.outcome, minutes } });
  setTimeout(() => dropCallState(callSid), 60_000);
}
