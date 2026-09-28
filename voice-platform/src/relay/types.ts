import type { z } from "zod";
import type { Lead, Tenant } from "../db.js";
import type { MessageParam, TextBlockParam } from "../llm.js";

export type AgentMode = "receptionist" | "sales" | "demo" | "voicemail";

/** What happens to the phone call when an AI session ends. Sent to Twilio as handoffData. */
export type Handoff =
  | { action: "hangup"; reason?: string }
  | { action: "transfer"; to: string; reason: string; returnMode: AgentMode }
  | { action: "start_demo" }
  | { action: "end_demo" }
  | { action: "voicemail" };

export interface TranscriptLine {
  at: string;
  mode: AgentMode;
  who: "caller" | "agent" | "system";
  text: string;
}

/** Everything we know about one phone call. Lives in memory for the length of the call. */
export interface CallState {
  callSid: string;
  direction: "inbound" | "outbound";
  kind: AgentMode;
  from: string;
  to: string;
  leadId?: number;
  tenantId?: number;
  /** For demo calls from strangers on the demo line: the business they asked us to pretend to be. */
  demoBusiness?: { name: string; type: string };
  histories: Partial<Record<AgentMode, MessageParam[]>>;
  transcript: TranscriptLine[];
  /** Notes to hand the model on its next turn (interruptions, preview opened, demo finished...). */
  pendingNotes: string[];
  outcome?: string;
  summary?: string;
  messageTaken?: boolean;
  voicemailSuspected?: boolean;
  answeredBy?: string;
  startedAt: number;
  finalized?: boolean;
  flags: Record<string, unknown>;
}

export interface ToolContext {
  call: CallState;
  lead?: Lead;
  tenant?: Tenant;
  /** Send DTMF tones on the live call (for phone menus). */
  sendDigits(digits: string): void;
}

export interface ToolResult {
  content: string;
  isError?: boolean;
  /** End this AI session after the current words finish playing, then do this. */
  handoff?: Handoff;
  /** Stop without speaking again this turn (e.g. voicemail detected). */
  silent?: boolean;
}

export interface AgentTool<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  schema: S;
  run(input: z.infer<S>, ctx: ToolContext): Promise<ToolResult>;
}

/** Declare a tool so its `run` input is typed from its zod schema. */
export function tool<S extends z.ZodType>(t: AgentTool<S>): AgentTool {
  return t as unknown as AgentTool;
}

export interface Agent {
  mode: AgentMode;
  /** Stable instructions first (cached), call-specific dossier second. */
  system: TextBlockParam[];
  tools: AgentTool[];
  /** If set, the AI speaks first with this note as its cue (used for resumes and outbound calls). */
  openingCue?: { afterMs: number; note: string };
  /** For voicemail mode: hang up this many ms after the greeting starts. */
  hangupAfterMs?: number;
}
