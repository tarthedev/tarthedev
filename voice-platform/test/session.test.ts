import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- a scripted stand-in for Claude's streaming API ----
type Scripted = { text?: string; toolUses?: { name: string; input: unknown }[]; slowMs?: number };
const script: Scripted[] = [];
const requests: Record<string, unknown>[] = [];

class FakeStream {
  private handlers: ((d: string) => void)[] = [];
  constructor(
    private step: Scripted,
    private signal?: AbortSignal,
  ) {}
  on(event: string, cb: (d: string) => void) {
    if (event === "text") this.handlers.push(cb);
    return this;
  }
  async finalMessage() {
    const words = (this.step.text ?? "").split(/(?<= )/);
    for (const w of words) {
      if (this.step.slowMs) await new Promise((r) => setTimeout(r, this.step.slowMs));
      if (this.signal?.aborted) throw new Error("aborted");
      this.handlers.forEach((h) => h(w));
    }
    const content: unknown[] = [];
    if (this.step.text) content.push({ type: "text", text: this.step.text });
    (this.step.toolUses ?? []).forEach((t, i) => content.push({ type: "tool_use", id: `tu_${i}_${Date.now()}`, name: t.name, input: t.input }));
    return {
      content,
      stop_reason: this.step.toolUses?.length ? "tool_use" : "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
    };
  }
}

vi.mock("../src/llm.js", async (orig) => {
  const real = await orig<typeof import("../src/llm.js")>();
  return {
    ...real,
    anthropic: () => ({
      beta: {
        messages: {
          stream: (params: Record<string, unknown>, opts?: { signal?: AbortSignal }) => {
            requests.push(structuredClone(params));
            const step = script.shift() ?? { text: "Okay." };
            return new FakeStream(step, opts?.signal);
          },
        },
      },
    }),
  };
});

vi.mock("../src/tools/twilio.js", async (orig) => {
  const real = await orig<typeof import("../src/tools/twilio.js")>();
  return { ...real, sendSms: vi.fn(async () => "SM123"), startRecording: vi.fn(async () => {}) };
});

const { resetDbForTests, upsertLead, getLead, isDnc } = await import("../src/db.js");
const { RelaySession } = await import("../src/relay/session.js");
const { sendSms } = await import("../src/tools/twilio.js");

class FakeWs extends EventEmitter {
  OPEN = 1;
  readyState = 1;
  sent: Record<string, unknown>[] = [];
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
    this.emit("close");
  }
  push(msg: Record<string, unknown>) {
    this.emit("message", Buffer.from(JSON.stringify(msg)));
  }
  spoken() {
    return this.sent.filter((m) => m.type === "text").map((m) => m.token).join("");
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean, ms = 8000) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error("timed out waiting");
    await wait(20);
  }
}

let leadId: number;
beforeEach(() => {
  resetDbForTests();
  script.length = 0;
  requests.length = 0;
  leadId = upsertLead({
    business_name: "Albemarle Roofing",
    category: "Roofing contractor",
    phone: "+12525550199",
    line_type: "landline",
    website_status: "none",
    pitch: "website",
    source: "places",
    city: "Elizabeth City",
    state: "NC",
    preview_slug: "albemarle-roofing-ab12",
    preview_json: "{}",
  }).id;
});

function start(callSid: string) {
  const ws = new FakeWs();
  new RelaySession(ws as never, { cs: callSid, m: "sales" });
  ws.push({
    type: "setup",
    callSid,
    from: "+12525550100",
    to: "+12525550199",
    direction: "outbound-api",
    customParameters: { mode: "sales", leadId: String(leadId), direction: "outbound" },
  });
  return ws;
}

describe("AI call session", () => {
  it("streams the reply to Twilio and sends the model the right request", async () => {
    script.push({ text: "Hey, this is Riley, I'm an AI assistant calling for Aaron Rollinson. Is this the owner?" });
    const ws = start("CA_stream");
    ws.push({ type: "prompt", voicePrompt: "Albemarle Roofing, this is Mike.", last: true });
    await until(() => ws.sent.some((m) => m.type === "text" && m.last === true));
    expect(ws.spoken()).toContain("I'm an AI assistant");

    const req = requests[0] as { model: string; system: { text: string; cache_control?: unknown }[]; tools: { name: string }[]; betas?: string[]; messages: unknown[] };
    expect(req.model).toBe("claude-opus-5");
    expect(req.betas).toContain("server-side-fallback-2026-07-01");
    expect(req.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(req.system[1].text).toContain("Albemarle Roofing");
    expect(req.tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(["text_preview_link", "start_live_receptionist_demo", "send_payment_link", "mark_do_not_call", "end_call"]),
    );
    expect(JSON.stringify(req.messages)).toContain("this is Mike");
    ws.close();
  });

  it("runs tools and continues the turn (texting the preview link)", async () => {
    script.push({ text: "One sec. ", toolUses: [{ name: "text_preview_link", input: { mobile: "252-555-0142" } }] });
    script.push({ text: "Okay, just sent it over." });
    const ws = start("CA_tool");
    ws.push({ type: "prompt", voicePrompt: "Sure, text it to 252 555 0142.", last: true });
    await until(() => ws.spoken().includes("just sent it"));
    expect(sendSms).toHaveBeenCalledWith("+12525550142", expect.stringContaining("https://voice.example.test/p/albemarle-roofing-ab12"));
    expect(getLead(leadId)?.mobile).toBe("+12525550142");
    // The second request carries the tool result right after the tool call.
    const msgs = (requests[1] as { messages: { role: string; content: unknown }[] }).messages;
    expect(msgs.at(-1)?.role).toBe("user");
    expect(JSON.stringify(msgs.at(-1)?.content)).toContain("tool_result");
    ws.close();
  });

  it("honors do-not-call requests and ends the session", async () => {
    script.push({ text: "Sorry about that, I'll take you off our list. Take care.", toolUses: [{ name: "mark_do_not_call", input: {} }] });
    const ws = start("CA_dnc");
    ws.push({ type: "prompt", voicePrompt: "Stop calling me.", last: true });
    await until(() => ws.sent.some((m) => m.type === "end"), 12000);
    expect(isDnc("+12525550199")).toBe(true);
    expect(getLead(leadId)?.status).toBe("dnc");
    const end = ws.sent.find((m) => m.type === "end")!;
    expect(JSON.parse(end.handoffData as string)).toMatchObject({ action: "hangup", reason: "dnc" });
  });

  it("stops talking when interrupted and tells the model what the caller heard", async () => {
    script.push({ text: "So Aaron builds websites for local businesses and he already put together a preview for you and ", slowMs: 60 });
    script.push({ text: "Oh, gotcha." });
    const ws = start("CA_interrupt");
    ws.push({ type: "prompt", voicePrompt: "Hello?", last: true });
    await until(() => ws.spoken().length > 20);
    ws.push({ type: "interrupt", utteranceUntilInterrupt: "So Aaron builds websites" });
    ws.push({ type: "prompt", voicePrompt: "I'm driving right now.", last: true });
    await until(() => ws.spoken().includes("gotcha"));
    const msgs = (requests[1] as { messages: { role: string; content: unknown }[] }).messages;
    const lastUser = JSON.stringify(msgs.at(-1));
    expect(lastUser).toContain("They heard you up to");
    expect(lastUser).toContain("I'm driving right now.");
    // The cut-off reply is kept as what was actually said, not the full planned text.
    const assistant = msgs.filter((m) => m.role === "assistant");
    expect(JSON.stringify(assistant.at(-1))).not.toContain("already put together a preview for you and");
    ws.close();
  });

  it("speaks first on an outbound call if the other side stays silent", async () => {
    script.push({ text: "Hey there, this is Riley, an AI assistant calling for Aaron Rollinson." });
    const ws = start("CA_silent");
    await until(() => ws.spoken().includes("Riley"), 6000);
    expect(JSON.stringify((requests[0] as { messages: unknown[] }).messages)).toContain("call_event");
    ws.close();
  });

  it("closes connections for a different call", async () => {
    const ws = new FakeWs();
    new RelaySession(ws as never, { cs: "CA_expected", m: "sales" });
    ws.push({ type: "setup", callSid: "CA_other", from: "x", to: "y", customParameters: { mode: "sales" } });
    await wait(50);
    expect(ws.readyState).toBe(3);
  });
});
