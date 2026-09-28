import twilio from "twilio";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/tools/twilio.js", async (orig) => {
  const real = await orig<typeof import("../src/tools/twilio.js")>();
  const create = vi.fn(async (_p: Record<string, unknown>) => ({ sid: `CA_out_${Date.now()}` }));
  return {
    ...real,
    sendSms: vi.fn(async () => "SM1"),
    redirectCall: vi.fn(async () => {}),
    endCall: vi.fn(async () => {}),
    twilioClient: () => ({ calls: { create } }),
  };
});

const { buildServer } = await import("../src/index.js");
const db = await import("../src/db.js");
const { createCall } = await import("../src/relay/calls.js");
const { readToken } = await import("../src/lib/util.js");
const { redirectCall, twilioClient } = await import("../src/tools/twilio.js");

const BASE = "https://voice.example.test";
type App = Awaited<ReturnType<typeof buildServer>>;
let app: App;

beforeAll(async () => {
  app = await buildServer();
});
afterAll(() => app.close());
beforeEach(() => {
  db.resetDbForTests();
});

/** POST a form the way Twilio does, correctly signed. */
function twilioPost(path: string, params: Record<string, string>) {
  const signature = twilio.getExpectedTwilioSignature("test-auth-token", BASE + path, params);
  return app.inject({
    method: "POST",
    url: path,
    headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": signature },
    payload: new URLSearchParams(params).toString(),
  });
}

function relayUrl(xml: string) {
  const m = /url="([^"]+)"/.exec(xml);
  return m ? m[1].replace(/&amp;/g, "&") : "";
}

describe("Twilio webhooks", () => {
  it("rejects unsigned requests", async () => {
    const r = await app.inject({ method: "POST", url: "/twilio/voice/inbound", payload: "To=%2B1", headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(r.statusCode).toBe(403);
  });

  it("answers a receptionist client's line as that business", async () => {
    db.saveTenant({ business_name: "Pasquotank Plumbing", slug: "pp", phone_number: "+12525550111", agent_name: "Sam", active: 1, knowledge: "Plumbing" });
    const r = await twilioPost("/twilio/voice/inbound", { CallSid: "CA1", To: "+12525550111", From: "+12525550999" });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain("<ConversationRelay");
    expect(r.body).toContain("Thanks for calling Pasquotank Plumbing!");
    expect(r.body).toContain('name="mode" value="receptionist"');
    const token = new URL(relayUrl(r.body)).searchParams.get("t");
    expect(readToken(token)).toMatchObject({ cs: "CA1", m: "receptionist" });
  });

  it("turns away calls to a switched-off client", async () => {
    db.saveTenant({ business_name: "Off Co", slug: "off", phone_number: "+12525550112", active: 0 });
    const r = await twilioPost("/twilio/voice/inbound", { CallSid: "CA2", To: "+12525550112", From: "+12525550999" });
    expect(r.body).toContain("<Hangup/>");
  });

  it("demo line answers as the caller's own business when it recognizes their cell", async () => {
    db.upsertLead({ business_name: "Camden Tree & Stump", phone: "+12525550150", mobile: "+12525550151", source: "places" });
    const known = await twilioPost("/twilio/voice/inbound", { CallSid: "CA3", To: "+12525550101", From: "+12525550151" });
    expect(known.body).toContain("Thanks for calling Camden Tree &amp; Stump!");
    const stranger = await twilioPost("/twilio/voice/inbound", { CallSid: "CA4", To: "+12525550101", From: "+12525550777" });
    expect(stranger.body).toContain("AI receptionist demo");
  });

  it("patches the live receptionist demo into a sales call and back", async () => {
    const { id } = db.upsertLead({ business_name: "Currituck Pest Control", phone: "+12525550160", source: "places" });
    createCall({ callSid: "CA5", direction: "outbound", kind: "sales", from: "+12525550100", to: "+12525550160", leadId: id });
    const toDemo = await twilioPost("/twilio/relay/action?mode=sales", { CallSid: "CA5", HandoffData: JSON.stringify({ action: "start_demo" }) });
    expect(toDemo.body).toContain("Thanks for calling Currituck Pest Control!");
    expect(toDemo.body).toContain('name="mode" value="demo"');
    expect(toDemo.body).toContain('name="from" value="sales"');
    const back = await twilioPost("/twilio/relay/action?mode=demo", { CallSid: "CA5", HandoffData: JSON.stringify({ action: "end_demo" }) });
    expect(back.body).toContain('name="mode" value="sales"');
    expect(back.body).toContain('name="resume" value="demo"');
  });

  it("transfers with a screened whisper and returns to the AI when nobody accepts", async () => {
    createCall({ callSid: "CA6", direction: "outbound", kind: "sales", from: "+12525550100", to: "+12525550160" });
    const t = await twilioPost("/twilio/relay/action?mode=sales", {
      CallSid: "CA6",
      HandoffData: JSON.stringify({ action: "transfer", to: "+12522503044", reason: "wants the website", returnMode: "sales" }),
    });
    expect(t.body).toContain("<Dial");
    expect(t.body).toContain("+12522503044");
    expect(t.body).toContain("/twilio/whisper?text=");
    const missed = await twilioPost("/twilio/dial/result?mode=sales&resume=transfer_failed", { CallSid: "CA6", DialCallStatus: "no-answer", DialBridged: "false" });
    expect(missed.body).toContain('name="resume" value="transfer_failed"');
    // Voicemail answering the owner's phone isn't a real answer: back to the AI.
    const vm = await twilioPost("/twilio/dial/result?mode=sales&resume=transfer_failed", { CallSid: "CA6", DialCallStatus: "completed" });
    expect(vm.body).toContain('name="resume" value="transfer_failed"');
    // The owner pressed 1, so the call was connected and is now over.
    const accept = await twilioPost("/twilio/whisper/accept", { CallSid: "CA6child", ParentCallSid: "CA6", Digits: "1" });
    expect(accept.body).toBe('<?xml version="1.0" encoding="UTF-8"?><Response/>');
    const took = await twilioPost("/twilio/dial/result?mode=sales&resume=transfer_failed", { CallSid: "CA6", DialCallStatus: "completed" });
    expect(took.body).toContain("<Hangup/>");
  });

  it("drops a voicemail when answering-machine detection hears the beep", async () => {
    const { id } = db.upsertLead({ business_name: "Perquimans Auto", phone: "+12525550170", source: "places" });
    createCall({ callSid: "CA7", direction: "outbound", kind: "sales", from: "+12525550100", to: "+12525550170", leadId: id });
    await twilioPost("/twilio/amd", { CallSid: "CA7", AnsweredBy: "machine_end_beep" });
    expect(redirectCall).toHaveBeenCalledWith("CA7", expect.stringContaining("This message is for Perquimans Auto"));
    expect(vi.mocked(redirectCall).mock.calls[0][1]).toContain('interruptible="none"');
  });

  it("adds people who text STOP to the do-not-call list", async () => {
    await twilioPost("/twilio/sms/inbound", { From: "+12525550180", To: "+12525550100", Body: "stop" });
    expect(db.isDnc("+12525550180")).toBe(true);
  });
});

describe("website form", () => {
  const form = (extra: Record<string, unknown> = {}) => ({
    name: "Dana",
    business: "Dana's Salon",
    phone: "(252) 555-0190",
    interest: "receptionist",
    consent: true,
    started_at: Date.now() - 20_000,
    ...extra,
  });

  it("saves the lead with a consent record and schedules the call outside calling hours", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-30T03:00:00Z")); // 11 PM Eastern
    const r = await app.inject({ method: "POST", url: "/api/web-lead", payload: form() });
    vi.useRealTimers();
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.calling).toBe(false);
    expect(body.message).toMatch(/We'll call at/);
    const lead = db.findLeadByPhone("+12525550190")!;
    expect(lead.status).toBe("callback");
    expect(lead.next_attempt_at).toBe("2026-09-30T12:00:00.000Z"); // 8:00 AM Eastern
    const consent = JSON.parse(lead.consent_json!);
    expect(consent.ai_calls).toBe(true);
    expect(consent.text).toContain("AI-generated voice");
  });

  it("calls right away during calling hours, on the number they typed in", async () => {
    // Already on file from a cold call: business landline + a cell they gave us.
    db.upsertLead({ business_name: "Dana's Salon", phone: "+12525550290", mobile: "+12525550291", line_type: "landline", source: "places" });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-29T15:00:00Z")); // Tuesday 11 AM Eastern
    const r = await app.inject({ method: "POST", url: "/api/web-lead", payload: form({ phone: "252-555-0291", started_at: Date.now() - 20_000 }) });
    vi.useRealTimers();
    expect(r.json().calling).toBe(true);
    const create = (twilioClient() as unknown as { calls: { create: ReturnType<typeof vi.fn> } }).calls.create;
    const params = create.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(params.to).toBe("+12525550291");
    expect(params.from).toBe("+12525550100");
    expect(params.machineDetection).toBe("DetectMessageEnd");
    expect(String(params.url)).toContain("/twilio/voice/outbound?leadId=");
  });

  it("never auto-calls without the consent box", async () => {
    await app.inject({ method: "POST", url: "/api/web-lead", payload: form({ consent: false, phone: "252-555-0191" }) });
    const lead = db.findLeadByPhone("+12525550191")!;
    expect(lead.consent_json).toBeNull();
    expect(lead.status).toBe("new");
  });

  it("quietly drops bots (honeypot and instant submits)", async () => {
    await app.inject({ method: "POST", url: "/api/web-lead", payload: form({ website: "http://spam", phone: "252-555-0192" }) });
    await app.inject({ method: "POST", url: "/api/web-lead", payload: form({ started_at: Date.now(), phone: "252-555-0193" }) });
    expect(db.findLeadByPhone("+12525550192")).toBeUndefined();
    expect(db.findLeadByPhone("+12525550193")).toBeUndefined();
  });

  it("allows the website origin via CORS", async () => {
    const r = await app.inject({ method: "OPTIONS", url: "/api/web-lead", headers: { origin: "https://rollinsonnetwork.com", "access-control-request-method": "POST" } });
    expect(r.headers["access-control-allow-origin"]).toBe("https://rollinsonnetwork.com");
  });
});

describe("preview sites", () => {
  it("renders the lead's own page, escaped, and counts real views", async () => {
    const { id } = db.upsertLead({
      business_name: "Joe's <Best> Roofing",
      phone: "+12525550195",
      rating: 4.9,
      review_count: 31,
      source: "places",
      preview_slug: "joes-roofing-aa11",
      preview_json: JSON.stringify({
        copy: {
          headline: "Roof repair in Elizabeth City",
          subheadline: "Leaks fixed fast.",
          services: [{ name: "Roof repair", description: "We fix leaks." }],
          about: "Local roofers.",
          service_area: "Elizabeth City and nearby.",
          highlights: ["4.9 stars on Google"],
          faq: [{ question: "How do I get a quote?", answer: "Call or text us." }],
          review_quotes: [],
          theme: "brick",
        },
        reviews: [{ author: "Pat", quote: "Great work", rating: 5 }],
        generatedAt: new Date().toISOString(),
      }),
    });
    const r = await app.inject({ method: "GET", url: "/p/joes-roofing-aa11" });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain("Joe&apos;s &lt;Best&gt; Roofing");
    expect(r.body).not.toContain("<Best>");
    expect(r.body).toContain('href="tel:+12525550195"');
    expect(r.body).toContain("noindex");
    await app.inject({ method: "POST", url: "/p/joes-roofing-aa11/view" });
    expect(db.getLead(id)?.preview_views).toBe(1);
  });
});

describe("dashboard", () => {
  const auth = "Basic " + Buffer.from("aaron:pw").toString("base64");
  it("requires the password", async () => {
    expect((await app.inject({ method: "GET", url: "/admin" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/admin", headers: { authorization: "Basic " + Buffer.from("aaron:nope").toString("base64") } })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/admin", headers: { authorization: auth } })).statusCode).toBe(200);
  });
  it("blocks cross-site form posts", async () => {
    const r = await app.inject({ method: "POST", url: "/admin/dialer", headers: { authorization: auth, origin: "https://evil.example" }, payload: { action: "resume" } });
    expect(r.statusCode).toBe(403);
    const ok = await app.inject({ method: "POST", url: "/admin/dialer", headers: { authorization: auth, origin: BASE }, payload: { action: "pause" } });
    expect(ok.statusCode).toBe(302);
  });
  it("renders every page", async () => {
    const { id } = db.upsertLead({ business_name: "Test Lead", phone: "+12525550196", source: "manual", line_type: "mobile" });
    const t = db.saveTenant({ business_name: "Test Tenant", slug: "tt" });
    for (const url of ["/admin", "/admin/leads", `/admin/leads/${id}`, "/admin/manual", "/admin/calls", "/admin/tenants", `/admin/tenants/${t}`]) {
      const r = await app.inject({ method: "GET", url, headers: { authorization: auth } });
      expect(r.statusCode, url).toBe(200);
    }
  });
});

describe("Stripe webhook", () => {
  it("refuses events when no signing secret is configured", async () => {
    const r = await app.inject({ method: "POST", url: "/stripe/webhook", payload: "{}", headers: { "content-type": "application/json" } });
    expect(r.statusCode).toBe(503);
  });
});
