import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { voicemailScript } from "../agents/index.js";
import { demoGreeting, strangerGreeting, tenantGreeting } from "../agents/receptionist.js";
import { salesInboundGreeting } from "../agents/sales.js";
import { config } from "../config.js";
import { addDnc, findLeadByPhone, getLead, getTenant, getTenantByNumber, logEvent, upsertCall } from "../db.js";
import { escapeXml, toE164 } from "../lib/util.js";
import { formatPhone } from "../offer.js";
import { createCall, getCallState } from "../relay/calls.js";
import { finalizeCall } from "../relay/finalize.js";
import { dialTwiml, emptyTwiml, hangupTwiml, relayTwiml } from "../relay/twiml.js";
import type { AgentMode, CallState, Handoff } from "../relay/types.js";
import { notifyAaron, notifyOwner } from "../tools/notify.js";
import { endCall, redirectCall, validateTwilioSignature } from "../tools/twilio.js";

type Form = Record<string, string>;

const xml = (reply: FastifyReply, body: string) => reply.type("text/xml").send(body);

const STOP_WORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPTOUT"]);

function whisperPath(text: string) {
  return `/twilio/whisper?text=${encodeURIComponent(text.slice(0, 200))}`;
}

/** TwiML to (re)start the AI in a given mode on a live call. */
function relayFor(call: CallState, mode: AgentMode, extra: Record<string, string> = {}, welcomeGreeting?: string) {
  const lead = call.leadId ? getLead(call.leadId) : undefined;
  const tenant = call.tenantId ? getTenant(call.tenantId) : undefined;
  const voice =
    mode === "receptionist"
      ? tenant?.voice || config.RECEPTIONIST_VOICE
      : mode === "demo"
        ? config.RECEPTIONIST_VOICE
        : config.SALES_VOICE;
  return relayTwiml({
    callSid: call.callSid,
    mode,
    voice,
    welcomeGreeting,
    interruptible: mode !== "voicemail",
    hints: [lead?.business_name, tenant?.business_name].filter((x): x is string => Boolean(x)),
    params: {
      leadId: call.leadId,
      tenantId: call.tenantId,
      direction: call.direction,
      ...extra,
    },
  });
}

export async function twilioRoutes(app: FastifyInstance) {
  // Every Twilio webhook must carry a valid X-Twilio-Signature.
  app.addHook("preHandler", async (req: FastifyRequest, reply: FastifyReply) => {
    const url = config.PUBLIC_BASE_URL.replace(/\/$/, "") + req.url;
    const ok = validateTwilioSignature(req.headers["x-twilio-signature"] as string | undefined, url, (req.body as Form) ?? {});
    if (!ok) {
      req.log.warn({ url }, "invalid Twilio signature");
      return reply.code(403).send("invalid signature");
    }
  });

  // ---------- inbound calls: receptionist clients, demo line, sales line ----------
  app.post("/twilio/voice/inbound", async (req, reply) => {
    const b = req.body as Form;
    const to = b.To;
    const from = b.From;

    const tenant = getTenantByNumber(to);
    if (tenant) {
      if (!tenant.active) return xml(reply, hangupTwiml("Sorry, this number isn't taking calls right now. Goodbye."));
      const call = createCall({ callSid: b.CallSid, direction: "inbound", kind: "receptionist", from, to, tenantId: tenant.id });
      return xml(reply, relayFor(call, "receptionist", {}, tenantGreeting(tenant)));
    }

    if (config.DEMO_LINE_NUMBER && to === config.DEMO_LINE_NUMBER) {
      const lead = findLeadByPhone(from);
      const call = createCall({ callSid: b.CallSid, direction: "inbound", kind: "demo", from, to, leadId: lead?.id });
      logEvent({ type: "demo_line_call", leadId: lead?.id, callSid: b.CallSid, data: { from } });
      return xml(reply, relayFor(call, "demo", { from: "line" }, lead ? demoGreeting(lead.business_name) : strangerGreeting()));
    }

    if (config.SALES_CALLER_ID && to === config.SALES_CALLER_ID) {
      // Someone calling the number the AI called them from. Ring Aaron first (screened, so his
      // voicemail can't swallow the call); if he doesn't take it, the AI picks up.
      const lead = findLeadByPhone(from);
      const call = createCall({ callSid: b.CallSid, direction: "inbound", kind: "sales", from, to, leadId: lead?.id });
      logEvent({ type: "sales_line_call", leadId: lead?.id, callSid: b.CallSid });
      if (config.ALLOW_LIVE_TRANSFER && config.OWNER_CELL) {
        const who = lead ? lead.business_name : formatPhone(from);
        return xml(
          reply,
          dialTwiml({
            to: config.OWNER_CELL,
            callerId: toE164(from) ?? config.SALES_CALLER_ID,
            timeout: 15,
            actionPath: `/twilio/dial/result?mode=sales&resume=inbound`,
            whisperPath: whisperPath(`Rollinson Network call back from ${who}`),
          }),
        );
      }
      return xml(reply, relayFor(call, "sales", {}, salesInboundGreeting()));
    }

    req.log.warn({ to }, "call to an unknown number");
    return xml(reply, hangupTwiml("Sorry, this number isn't in service."));
  });

  // ---------- outbound sales call answered ----------
  app.post("/twilio/voice/outbound", async (req, reply) => {
    const b = req.body as Form;
    const leadId = Number((req.query as Form).leadId);
    const call = createCall({ callSid: b.CallSid, direction: "outbound", kind: "sales", from: b.From, to: b.To, leadId });
    return xml(reply, relayFor(call, "sales"));
  });

  // ---------- an AI session ended: do what it asked ----------
  app.post("/twilio/relay/action", async (req, reply) => {
    const b = req.body as Form;
    const call = getCallState(b.CallSid);
    let handoff: Handoff | null = null;
    try {
      handoff = b.HandoffData ? (JSON.parse(b.HandoffData) as Handoff) : null;
    } catch {
      handoff = null;
    }
    if (b.ErrorCode) req.log.error({ code: b.ErrorCode, msg: b.ErrorMessage }, "ConversationRelay session error");
    if (!call || !handoff) {
      if (b.ErrorCode && call) {
        return xml(reply, hangupTwiml("Sorry, we're having trouble with this call. Please call back in a minute."));
      }
      return xml(reply, hangupTwiml());
    }

    switch (handoff.action) {
      case "hangup":
        return xml(reply, hangupTwiml());
      case "transfer": {
        const tenant = call.tenantId ? getTenant(call.tenantId) : undefined;
        // Show the owner who's calling when we can; otherwise our own number.
        const fallbackId = tenant?.phone_number ?? config.SALES_CALLER_ID;
        const callerId = call.direction === "inbound" ? (toE164(call.from) ?? fallbackId) : fallbackId;
        const label = tenant ? tenant.business_name : "Rollinson Network AI";
        return xml(
          reply,
          dialTwiml({
            to: handoff.to,
            callerId,
            actionPath: `/twilio/dial/result?mode=${handoff.returnMode}&resume=transfer_failed`,
            whisperPath: whisperPath(`${label} transfer: ${handoff.reason}`),
          }),
        );
      }
      case "start_demo": {
        const lead = call.leadId ? getLead(call.leadId) : undefined;
        const name = lead?.business_name ?? call.demoBusiness?.name ?? "your business";
        return xml(reply, relayFor(call, "demo", { from: call.kind === "sales" ? "sales" : "line" }, demoGreeting(name)));
      }
      case "end_demo":
        return xml(reply, relayFor(call, "sales", { resume: "demo" }));
      case "voicemail": {
        const lead = call.leadId ? getLead(call.leadId) : undefined;
        return xml(reply, relayFor(call, "voicemail", {}, voicemailScript(lead)));
      }
    }
  });

  // Transfer / ring-first finished. If nobody took the call, hand it back to the AI.
  app.post("/twilio/dial/result", async (req, reply) => {
    const b = req.body as Form;
    const q = req.query as Form;
    const call = getCallState(b.CallSid);
    // Only a person pressing 1 on the whisper counts as answered; a voicemail picking up doesn't.
    const bridged = b.DialBridged === "true" || call?.flags.bridged === true;
    if (call) call.flags.bridged = false;
    if (bridged || !call) return xml(reply, hangupTwiml());
    const mode = (q.mode as AgentMode) || call.kind;
    if (q.resume === "inbound") return xml(reply, relayFor(call, mode, {}, salesInboundGreeting()));
    return xml(reply, relayFor(call, mode, { resume: "transfer_failed" }));
  });

  // Played to the person we're transferring to. They press 1 to accept, so voicemail can't answer for them.
  app.post("/twilio/whisper", async (req, reply) => {
    const text = (req.query as Form).text ?? "Incoming call";
    return xml(
      reply,
      `<?xml version="1.0" encoding="UTF-8"?><Response><Gather numDigits="1" timeout="8" action="${config.PUBLIC_BASE_URL.replace(/\/$/, "")}/twilio/whisper/accept"><Say voice="Polly.Joanna-Neural">${escapeXml(text)}. Press 1 to take the call.</Say></Gather><Hangup/></Response>`,
    );
  });
  app.post("/twilio/whisper/accept", async (req, reply) => {
    const b = req.body as Form;
    const parent = b.ParentCallSid ? getCallState(b.ParentCallSid) : undefined;
    if (b.Digits === "1") {
      if (parent) parent.flags.bridged = true;
      return xml(reply, emptyTwiml()); // connects the call
    }
    return xml(reply, hangupTwiml());
  });

  // ---------- call lifecycle ----------
  app.post("/twilio/status", async (req, reply) => {
    const b = req.body as Form;
    const status = b.CallStatus;
    if (["completed", "busy", "no-answer", "failed", "canceled"].includes(status)) {
      void finalizeCall(b.CallSid, {
        status,
        durationSec: b.CallDuration ? Number(b.CallDuration) : undefined,
        answeredBy: b.AnsweredBy,
      }).catch((e) => req.log.error(e, "finalize failed"));
    } else {
      upsertCall({ call_sid: b.CallSid, status });
    }
    return xml(reply, emptyTwiml());
  });

  // Async answering-machine detection for outbound sales calls.
  app.post("/twilio/amd", async (req, reply) => {
    const b = req.body as Form;
    const answeredBy = b.AnsweredBy ?? "unknown";
    upsertCall({ call_sid: b.CallSid, answered_by: answeredBy });
    const call = getCallState(b.CallSid);
    if (call) call.answeredBy = answeredBy;
    if (answeredBy.startsWith("machine_end") || answeredBy === "fax") {
      try {
        if (answeredBy !== "fax" && config.VOICEMAIL_MODE === "leave" && call) {
          call.outcome = "voicemail";
          const lead = call.leadId ? getLead(call.leadId) : undefined;
          await redirectCall(b.CallSid, relayFor(call, "voicemail", {}, voicemailScript(lead)));
        } else {
          await endCall(b.CallSid);
        }
      } catch (e) {
        req.log.error(e, "AMD handling failed");
      }
    }
    return xml(reply, emptyTwiml());
  });

  app.post("/twilio/recording", async (req, reply) => {
    const b = req.body as Form;
    if (b.RecordingUrl) upsertCall({ call_sid: b.CallSid, recording_url: `${b.RecordingUrl}.mp3` });
    return xml(reply, emptyTwiml());
  });

  // ---------- texts ----------
  app.post("/twilio/sms/inbound", async (req, reply) => {
    const b = req.body as Form;
    const text = (b.Body ?? "").trim();
    const from = b.From;
    if (STOP_WORDS.has(text.toUpperCase())) {
      addDnc(from, "texted STOP", "sms");
      logEvent({ type: "sms_stop", data: { from } });
      return xml(reply, emptyTwiml()); // Twilio sends the opt-out confirmation itself
    }
    const tenant = getTenantByNumber(b.To);
    if (tenant) {
      await notifyOwner({
        cell: tenant.owner_cell,
        sms: `💬 Text to your ${tenant.business_name} line from ${formatPhone(from)}: ${text}`,
        smsFrom: tenant.phone_number,
      });
      return xml(reply, emptyTwiml());
    }
    const lead = findLeadByPhone(from);
    logEvent({ type: "sms_in", leadId: lead?.id, data: { from, text } });
    await notifyAaron(`💬 Text from ${lead ? lead.business_name : "unknown"} (${formatPhone(from)}): ${text}`);
    return xml(reply, emptyTwiml());
  });
}

