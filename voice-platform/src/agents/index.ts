import { config } from "../config.js";
import { getLead, type Lead } from "../db.js";
import { estimateSpeechMs } from "../lib/util.js";
import { speakablePhone } from "../offer.js";
import type { Agent, AgentMode, CallState } from "../relay/types.js";
import { buildDemoReceptionist, buildTenantReceptionist } from "./receptionist.js";
import { buildSalesAgent } from "./sales.js";

export function buildAgent(mode: AgentMode, call: CallState, params: Record<string, string>): Agent {
  switch (mode) {
    case "sales":
      return buildSalesAgent(call, params);
    case "receptionist":
      return buildTenantReceptionist(call, params);
    case "demo":
      return buildDemoReceptionist(call, params);
    case "voicemail": {
      const lead = call.leadId ? getLead(call.leadId) : undefined;
      return { mode, system: [], tools: [], hangupAfterMs: estimateSpeechMs(voicemailScript(lead)) + 1500 };
    }
  }
}

/** The message left when answering-machine detection hears a beep. Spoken by the same ElevenLabs voice. */
export function voicemailScript(lead?: Lead): string {
  const owner = config.OWNER_FIRST_NAME;
  const phone = speakablePhone(config.OWNER_CELL);
  const who = lead ? `This message is for ${lead.business_name}. ` : "";
  const receptionist = lead?.pitch === "receptionist";
  const pitch = receptionist
    ? `${owner} sets up AI receptionists that answer your phone when you can't, and wanted to let you hear one answer as ${lead?.business_name ?? "your business"}.`
    : `${owner} put together a free preview of a new website for ${lead?.business_name ?? "your business"}, no charge, and wanted to get it in front of you.`;
  return `Hi! ${who}This is ${config.SALES_AGENT_NAME}, an AI assistant calling for ${config.OWNER_NAME} with ${config.BUSINESS_NAME}, here in ${config.HOME_CITY}. ${pitch} If you'd like to see it, call or text ${owner} at ${phone}. Again, that's ${phone}. Thanks, and have a great day!`;
}
