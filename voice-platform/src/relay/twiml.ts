import { publicUrl, wsUrl } from "../config.js";
import { escapeXml, makeToken } from "../lib/util.js";
import type { AgentMode } from "./types.js";

const STT_HINTS = ["Rollinson", "Rollinson Network", "Elizabeth City", "Pasquotank", "Camden", "Currituck", "Perquimans", "Albemarle"];

export interface RelayOptions {
  callSid: string;
  mode: AgentMode;
  voice: string;
  welcomeGreeting?: string;
  /** Let the caller talk over the AI. Off only for voicemail drops. */
  interruptible?: boolean;
  params?: Record<string, string | number | undefined>;
  hints?: string[];
}

/** <Connect><ConversationRelay> pointing at our WebSocket, with a signed per-call token. */
export function relayTwiml(o: RelayOptions): string {
  const token = makeToken({ cs: o.callSid, m: o.mode }, 4 * 3600);
  const url = `${wsUrl("/relay")}?t=${encodeURIComponent(token)}`;
  const action = publicUrl(`/twilio/relay/action?mode=${o.mode}`);
  const interruptible = o.interruptible === false ? "none" : "any";
  const hints = [...STT_HINTS, ...(o.hints ?? [])]
    .map((h) => h.replace(/,/g, " ").trim())
    .filter(Boolean)
    .slice(0, 50)
    .join(",");
  const attrs: Record<string, string> = {
    url,
    ttsProvider: "ElevenLabs",
    voice: o.voice,
    transcriptionProvider: "Deepgram",
    speechModel: process.env.STT_MODEL || "nova-3-general",
    language: "en-US",
    interruptible,
    welcomeGreetingInterruptible: interruptible,
    ignoreBackchannel: "true",
    hints,
  };
  if (o.welcomeGreeting) attrs.welcomeGreeting = o.welcomeGreeting;
  const attrStr = Object.entries(attrs)
    .map(([k, v]) => `${k}="${escapeXml(v)}"`)
    .join(" ");
  const params = Object.entries({ mode: o.mode, ...(o.params ?? {}) } as Record<string, string | number | undefined>)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `<Parameter name="${escapeXml(k)}" value="${escapeXml(String(v))}"/>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Connect action="${escapeXml(action)}"><ConversationRelay ${attrStr}>${params}</ConversationRelay></Connect></Response>`;
}

export function hangupTwiml(say?: string): string {
  const s = say ? `<Say voice="Polly.Joanna-Neural">${escapeXml(say)}</Say>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${s}<Hangup/></Response>`;
}

export function dialTwiml(o: { to: string; callerId: string; actionPath: string; whisperPath?: string; timeout?: number }) {
  const whisper = o.whisperPath ? ` url="${escapeXml(publicUrl(o.whisperPath))}"` : "";
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Dial callerId="${escapeXml(o.callerId)}" timeout="${
    o.timeout ?? 20
  }" action="${escapeXml(publicUrl(o.actionPath))}"><Number${whisper}>${escapeXml(o.to)}</Number></Dial></Response>`;
}

export function sayTwiml(text: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Joanna-Neural">${escapeXml(text)}</Say></Response>`;
}

export const emptyTwiml = () => `<?xml version="1.0" encoding="UTF-8"?><Response/>`;

