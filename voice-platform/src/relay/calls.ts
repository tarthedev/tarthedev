import { upsertCall } from "../db.js";
import type { AgentMode, CallState, TranscriptLine } from "./types.js";

// In-memory state for calls in progress. One process handles all calls, which is
// plenty for a single VPS; the durable record of each call is the `calls` table.
const calls = new Map<string, CallState>();

export function createCall(init: {
  callSid: string;
  direction: "inbound" | "outbound";
  kind: AgentMode;
  from: string;
  to: string;
  leadId?: number;
  tenantId?: number;
}): CallState {
  const existing = calls.get(init.callSid);
  if (existing) return existing;
  const state: CallState = {
    ...init,
    histories: {},
    transcript: [],
    pendingNotes: [],
    startedAt: Date.now(),
    flags: {},
  };
  calls.set(init.callSid, state);
  upsertCall({
    call_sid: init.callSid,
    direction: init.direction,
    kind: init.kind === "voicemail" ? "sales" : init.kind,
    lead_id: init.leadId ?? null,
    tenant_id: init.tenantId ?? null,
    from_number: init.from,
    to_number: init.to,
    status: "in-progress",
  });
  return state;
}

export function getCallState(callSid: string): CallState | undefined {
  return calls.get(callSid);
}

export function dropCallState(callSid: string): void {
  calls.delete(callSid);
}

export function activeCalls(): CallState[] {
  return [...calls.values()];
}

export function addTranscript(call: CallState, who: TranscriptLine["who"], text: string, mode?: AgentMode) {
  const line = { at: new Date().toISOString(), mode: mode ?? call.kind, who, text };
  call.transcript.push(line);
  // Persist as we go so a crash mid-call still leaves a record.
  upsertCall({ call_sid: call.callSid, transcript_json: JSON.stringify(call.transcript) });
}

/** Queue a note for the model's next turn on this call (e.g. "the prospect just opened the preview"). */
export function noteForCall(callSid: string, note: string): boolean {
  const c = calls.get(callSid);
  if (!c) return false;
  c.pendingNotes.push(note);
  return true;
}

/** Find the live call (if any) for a lead, so events like "preview opened" can reach the agent. */
export function liveCallForLead(leadId: number): CallState | undefined {
  return [...calls.values()].find((c) => c.leadId === leadId && !c.finalized);
}
