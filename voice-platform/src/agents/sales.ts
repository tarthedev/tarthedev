import { z } from "zod";
import { config } from "../config.js";
import { appendLeadNote, getLead, logEvent, updateLead, upsertLead, type Lead } from "../db.js";
import { describeLocalNow, toE164, zonedToUtc } from "../lib/util.js";
import { formatPhone, offerFactsText, speakablePhone } from "../offer.js";
import { buildPreviewInBackground, previewUrl } from "../preview/generate.js";
import { tool, type Agent, type AgentTool, type CallState, type ToolContext } from "../relay/types.js";
import { createBooking, getSlots, summarizeSlots } from "../tools/calcom.js";
import { sendEmail } from "../tools/email.js";
import { notifyAaron } from "../tools/notify.js";
import { createCheckoutLink, PRODUCTS, type ProductKey } from "../tools/stripe.js";
import { sendSms } from "../tools/twilio.js";
import { endCallTool, honestyRules, markDoNotCallTool, pressKeysTool, VOICE_STYLE, voicemailDetectedTool } from "./common.js";

const OWNER = config.OWNER_FIRST_NAME;

function salesPlaybook(): string {
  const agent = config.SALES_AGENT_NAME;
  const biz = config.BUSINESS_NAME;
  return `You are ${agent}, an AI sales assistant calling on behalf of ${config.OWNER_NAME} at ${biz} in ${config.HOME_CITY}, North Carolina. ${OWNER} builds websites for local businesses and sets up AI receptionists that answer their phones. Your job on each call: find out whether the business has a problem ${OWNER} can fix, show them the real thing with a live demo instead of just describing it, and if they want it, text them a payment link. If they'd rather talk to a person first, book them a call with ${OWNER}.

Refer to ${OWNER} by name (pronouns: ${config.OWNER_PRONOUNS}).

${VOICE_STYLE}

${honestyRules(OWNER)}

# The call, step by step
1. Opening (every outbound call, no exceptions). Your first turn must say your name, that you're an AI assistant, who you're calling for, and (when the dossier says the call is recorded) that the call is recorded. Then ask one question. Example: "Hey, this is ${agent}, I'm an AI assistant calling for ${config.OWNER_NAME} over at ${biz} here in ${config.HOME_CITY}. Heads up, this call's recorded. Am I speaking with the owner of <business>?" Keep it about that short.
   - If they react to you being an AI, be relaxed and a little playful: "Yep! ${OWNER}'s a one-person shop, so I help reach folks. I'm actually a pretty good example of the receptionist thing we set up."
   - Gatekeeper (not the owner): ask for the owner's name and when's a good time to catch them. Offer to text the owner the preview. Use schedule_callback if they give a time. Don't pitch the gatekeeper hard.
   - Bad time: ask when's better, use schedule_callback, and end politely.
2. Hook. Use the dossier. Lead with the one specific thing you found, framed as an observation, never an insult:
   - No website: "I was looking up <business> on Google and couldn't find a website for y'all. ${OWNER} actually already put together a free preview of one, with your name, number, and reviews on it. Can I text it to you so you can pull it up while we're on the phone?"
   - Only a Facebook or directory page: same offer, with "a lot of folks searching on their phone skip right past Facebook pages."
   - Broken or dated website: mention the concrete problem from the audit (doesn't load, not secure, hard to use on a phone), then offer the preview.
   - Receptionist angle (trades, busy businesses with lots of reviews, or anyone who mentions missing calls): "Quick question, when you're out on a job and the phone rings, who picks up?" Then offer to let them hear it.
3. Demo. This is the most important part. Get them looking at or hearing the real thing while you're still on the line.
   - Website preview: ask for a cell number to text it to (the number you called may be a landline, which can't get texts). Use text_preview_link. If they'd rather have email, use email_preview_link. Then give them a moment to look, and ask what they think. Ask what's wrong with it: services, hours, colors. ${OWNER} fixes anything they don't like before it goes live.
   - Receptionist, live: "Want to hear how it'd answer for <business>? I can switch you over right now. You pretend you're a customer calling in, and say 'end demo' when you're done, and I'll hop back on." If yes, say "Okay, switching you over," and use start_live_receptionist_demo. The demo voice answers as their business.
   - Receptionist, later: text_receptionist_demo_number texts them a number they can call from their cell anytime. It answers as their business.
4. Objections: answer honestly and briefly (see below). Never argue. At most two soft attempts, then respect the no.
5. Close. When they say they want it, or ask how to get started:
   - Website: they pay when they're happy with it, not before. So only offer the payment link once they've looked at the preview and say they're happy with it as it is ("Want me to text you the link to get it live?"). If they want changes first, write the changes down with update_lead, tell them ${OWNER} will make them and send the updated preview, and book a call with ${OWNER} if they'd like one. Don't send a link for a site they haven't approved.
   - Receptionist: text the payment link for the receptionist plan. Existing website clients get the client rate.
   - Both: the bundle link.
   - Interested but not ready: book a 15-minute call with ${OWNER} (check_meeting_times, then book_meeting; you need their name and email, and you must spell the email back to confirm), or use text_booking_link so they can pick a time themselves.
   - Wants a real person right now: transfer_to_owner, if the dossier says transfers are available.
6. Wrap up: one sentence on what happens next, thank them, then end_call with the right outcome. Always finish with end_call.

# Objections (short, honest answers)
- "We already have a website": ask whether it brings in calls. If the audit found a real problem, mention that one problem. Otherwise switch to the receptionist.
- "Too expensive" or "what's it cost": the preview is free, and they only pay when they're happy with it. It's twelve hundred, the intro price for ${OWNER}'s first five clients, normally two thousand. Then stop talking.
- "I get all my work from word of mouth": "Totally. Even word-of-mouth customers usually Google you before they call, to get the number or check reviews."
- "Just send me some info": the preview is the info. Offer to text it and ask for a cell number.
- "How'd you get my number?" or "Is this a scam?": "Fair question. It's from your business listing on Google. ${OWNER}'s local, right here in ${config.HOME_CITY}. Want ${OWNER}'s cell? It's ${speakablePhone(config.OWNER_CELL)}."
- "I answer my own phone": "Makes sense. What happens when you're up on a ladder or under a sink?" If still no, drop it.
- "Not interested": one gentle check ("No worries. Is it the timing, or just not something you need?"), then thank them and end_call with not_interested. If they say don't call again, use mark_do_not_call.

# Automated systems
- If you reach an answering machine or voicemail greeting, use voicemail_detected immediately and say nothing.
- If you reach a phone menu, use press_keys to get to a person, preferably the owner or front office.

${offerFactsText()}`;
}

function leadDossier(lead: Lead | undefined, call: CallState): string {
  const tz = lead?.timezone || config.TIMEZONE;
  const lines = [`# This call`, `Local time: ${describeLocalNow(tz)}`];
  lines.push(`Direction: ${call.direction === "outbound" ? "you called them" : "they called the sales line"}`);
  lines.push(`Recorded: ${config.RECORD_SALES_CALLS ? "yes, mention it in your opening" : "no"}`);
  lines.push(
    `Live transfer to ${OWNER}: ${config.ALLOW_LIVE_TRANSFER ? "available (rings " + OWNER + "'s cell; if no answer you'll be told)" : "not available"}`,
  );
  lines.push(
    `Booking a call with ${OWNER}: ${config.CALCOM_API_KEY && config.CALCOM_EVENT_TYPE_ID ? "available" : config.CALCOM_BOOKING_URL ? "use text_booking_link" : "not set up; take a preferred time with schedule_callback"}`,
  );
  lines.push(`Payment links: ${config.STRIPE_SECRET_KEY ? "available" : "not set up; book a call instead"}`);
  lines.push(`Receptionist demo line: ${config.DEMO_LINE_NUMBER ? formatPhone(config.DEMO_LINE_NUMBER) : "not set up; use the live demo"}`);
  if (!lead) {
    lines.push("", "# Who you're talking to", "Unknown caller. Find out their name, business, and what they're after.");
    return lines.join("\n");
  }
  lines.push("", "# Who you're calling (dossier)");
  lines.push(`Business: ${lead.business_name}${lead.category ? ` (${lead.category})` : ""}`);
  if (lead.city) lines.push(`Location: ${[lead.city, lead.state].filter(Boolean).join(", ")}`);
  if (lead.contact_name) lines.push(`Contact name: ${lead.contact_name}`);
  if (lead.rating) lines.push(`Google rating: ${lead.rating} stars from ${lead.review_count ?? 0} reviews`);
  lines.push(`Website: ${lead.website ? lead.website : "none found on their Google listing"}`);
  if (lead.website_status) lines.push(`Website status: ${lead.website_status}`);
  if (lead.audit_json) {
    const audit = JSON.parse(lead.audit_json) as { issues?: string[] };
    if (audit.issues?.length) lines.push(`Website problems found: ${audit.issues.join("; ")}`);
  }
  lines.push(`Suggested pitch: ${lead.pitch ?? "website"}`);
  lines.push(
    `Free preview site: ${lead.preview_slug ? "ready to text" : "not built yet (text_preview_link will build it and text it within a couple of minutes)"}`,
  );
  if (lead.preview_views) lines.push(`They've opened the preview ${lead.preview_views} time(s) already.`);
  if (lead.is_client) lines.push(`Existing ${config.BUSINESS_NAME} website client: yes (receptionist client rate applies)`);
  if (lead.source === "web") lines.push("They filled out the form on rollinsonnetwork.com asking to be called. Thank them for reaching out.");
  if (lead.attempts > 0) lines.push(`Previous call attempts: ${lead.attempts}`);
  if (lead.notes) lines.push(`Notes from earlier calls:\n${lead.notes.split("\n").slice(-8).join("\n")}`);
  return lines.join("\n");
}

async function textTo(ctx: ToolContext, mobileRaw: string, body: string): Promise<string> {
  const mobile = toE164(mobileRaw);
  if (!mobile) throw new Error(`"${mobileRaw}" isn't a valid US phone number. Ask them to repeat it.`);
  await sendSms(mobile, body);
  if (ctx.lead && ctx.lead.mobile !== mobile) updateLead(ctx.lead.id, { mobile });
  return mobile;
}

function requireLead(ctx: ToolContext): Lead {
  if (ctx.lead) return ctx.lead;
  throw new Error("No business on file for this call yet. Ask their name and business, and use update_lead first.");
}

const salesTools = (): AgentTool[] => [
  tool({
    name: "text_preview_link",
    description:
      "Text the free website preview built for their business to a cell phone. Ask which cell to use; the number you called may be a landline.",
    schema: z.object({ mobile: z.string().describe("Cell number they gave, digits only is fine") }),
    async run({ mobile }, ctx) {
      const lead = requireLead(ctx);
      if (!lead.preview_slug) {
        const to = toE164(mobile);
        if (!to) throw new Error(`"${mobile}" isn't a valid US phone number.`);
        updateLead(lead.id, { mobile: to });
        buildPreviewInBackground(lead.id, { textTo: to });
        return { content: "The preview is being built now and will be texted to them within about two minutes. Tell them it's on the way." };
      }
      const url = previewUrl(getLead(lead.id)!);
      await textTo(
        ctx,
        mobile,
        `Hi, it's ${config.SALES_AGENT_NAME}, ${OWNER}'s AI assistant at ${config.BUSINESS_NAME}. Here's the free website preview ${OWNER} built for ${lead.business_name}: ${url}\nNo charge. Reply STOP to opt out.`,
      );
      logEvent({ type: "preview_texted", leadId: lead.id, callSid: ctx.call.callSid });
      return { content: "Texted. It can take a few seconds to arrive." };
    },
  }),
  tool({
    name: "email_preview_link",
    description: "Email the free website preview link. Spell the address back to them before calling this.",
    schema: z.object({ email: z.string().email() }),
    async run({ email }, ctx) {
      const lead = requireLead(ctx);
      if (!lead.preview_slug) {
        updateLead(lead.id, { email });
        buildPreviewInBackground(lead.id, { emailTo: email });
        return { content: "The preview is being built and will be emailed within about two minutes." };
      }
      const url = previewUrl(lead);
      await sendEmail({
        to: email,
        replyTo: config.OWNER_EMAIL,
        subject: `Your free website preview for ${lead.business_name}`,
        html: `<p>Hi,</p><p>Here's the preview ${OWNER} built for ${lead.business_name}: <a href="${url}">${url}</a></p><p>No charge. If anything's wrong (services, hours, colors), just reply and ${OWNER} will fix it.</p><p>${config.OWNER_NAME}<br>${config.BUSINESS_NAME} · ${formatPhone(config.OWNER_CELL)}</p>`,
      });
      updateLead(lead.id, { email });
      return { content: "Emailed." };
    },
  }),
  tool({
    name: "text_receptionist_demo_number",
    description:
      "Text them the AI receptionist demo number. When they call it from that cell, it answers as their business.",
    schema: z.object({ mobile: z.string() }),
    async run({ mobile }, ctx) {
      const lead = requireLead(ctx);
      if (!config.DEMO_LINE_NUMBER) throw new Error("The demo line isn't set up. Offer the live demo instead.");
      await textTo(
        ctx,
        mobile,
        `Call ${formatPhone(config.DEMO_LINE_NUMBER)} from this phone to hear how the AI receptionist would answer for ${lead.business_name}. Pretend you're a customer! Questions: ${OWNER}, ${formatPhone(config.OWNER_CELL)}. Reply STOP to opt out.`,
      );
      return { content: "Texted the demo number. It recognizes that cell and answers as their business." };
    },
  }),
  tool({
    name: "start_live_receptionist_demo",
    description:
      "Switch this call over to the AI receptionist, answering as their business, so they can try it as if they were a customer. They say 'end demo' to come back to you. Say 'Okay, switching you over' in the same turn first.",
    schema: z.object({}),
    async run(_input, ctx) {
      const lead = requireLead(ctx);
      logEvent({ type: "live_demo_started", leadId: lead.id, callSid: ctx.call.callSid });
      return { content: "Switching to the demo.", handoff: { action: "start_demo" } };
    },
  }),
  tool({
    name: "send_payment_link",
    description: `Text (or email) a secure Stripe checkout link. Only after they've said they want it. Products: ${Object.entries(
      PRODUCTS,
    )
      .map(([k, v]) => `${k} = ${v}`)
      .join("; ")}. Existing website clients get receptionist_addon; new customers wanting both get website_and_receptionist.`,
    schema: z.object({
      product: z.enum(Object.keys(PRODUCTS) as [ProductKey, ...ProductKey[]]),
      mobile: z.string().optional().describe("Cell to text the link to"),
      email: z.string().email().optional().describe("Email to send it to instead"),
    }),
    async run({ product, mobile, email }, ctx) {
      const lead = requireLead(ctx);
      if (!mobile && !email && !lead.mobile) throw new Error("Ask for a cell number or email to send the link to.");
      const url = await createCheckoutLink({ product, leadId: lead.id, businessName: lead.business_name, email: email ?? lead.email });
      const label = PRODUCTS[product];
      if (email) {
        await sendEmail({
          to: email,
          replyTo: config.OWNER_EMAIL,
          subject: `${config.BUSINESS_NAME}: your checkout link`,
          html: `<p>Here's your secure checkout link for ${label}:</p><p><a href="${url}">${url}</a></p><p>It expires in 24 hours. ${OWNER} will reach out as soon as it goes through.</p>`,
        });
      } else {
        await textTo(
          ctx,
          mobile ?? lead.mobile!,
          `${config.BUSINESS_NAME}: here's your secure checkout link for ${label}: ${url}\nExpires in 24 hrs. ${OWNER} will reach out as soon as it goes through. Questions: ${formatPhone(config.OWNER_CELL)}`,
        );
      }
      updateLead(lead.id, { status: "interested", ...(email ? { email } : {}) });
      logEvent({ type: "payment_link_sent", leadId: lead.id, callSid: ctx.call.callSid, data: { product } });
      void notifyAaron(`💳 Payment link sent to ${lead.business_name} for ${label}. Watch for the Stripe payment.`);
      return { content: `Sent the ${label} link.` };
    },
  }),
  tool({
    name: "check_meeting_times",
    description: `Look up open times on ${OWNER}'s calendar for a 15-minute call.`,
    schema: z.object({
      from_date: z.string().optional().describe("YYYY-MM-DD to start looking from; defaults to today"),
    }),
    async run({ from_date }, ctx) {
      if (!config.CALCOM_API_KEY || !config.CALCOM_EVENT_TYPE_ID) throw new Error("Calendar isn't connected. Use schedule_callback instead.");
      const tz = ctx.lead?.timezone || config.TIMEZONE;
      const start = from_date ? new Date(`${from_date}T00:00:00`) : new Date();
      const end = new Date(start.getTime() + 7 * 86400_000);
      const slots = await getSlots(
        { apiKey: config.CALCOM_API_KEY, eventTypeId: config.CALCOM_EVENT_TYPE_ID },
        start.toISOString(),
        end.toISOString(),
        tz,
      );
      return {
        content: `Open times (${tz}); offer two or three, not all of them. The ISO value in parentheses is what book_meeting needs.\n${summarizeSlots(slots, tz)}`,
      };
    },
  }),
  tool({
    name: "book_meeting",
    description: `Book a 15-minute call with ${OWNER}. Needs their name and email (spell the email back first) and a start time from check_meeting_times.`,
    schema: z.object({
      start: z.string().describe("ISO start time exactly as returned by check_meeting_times"),
      name: z.string(),
      email: z.string().email(),
      notes: z.string().optional().describe("What they want to talk about"),
    }),
    async run(input, ctx) {
      if (!config.CALCOM_API_KEY || !config.CALCOM_EVENT_TYPE_ID) throw new Error("Calendar isn't connected.");
      const tz = ctx.lead?.timezone || config.TIMEZONE;
      const phone = ctx.lead?.mobile ?? (ctx.call.direction === "outbound" ? ctx.call.to : ctx.call.from);
      const b = await createBooking(
        { apiKey: config.CALCOM_API_KEY, eventTypeId: config.CALCOM_EVENT_TYPE_ID },
        { ...input, timeZone: tz, phone, notes: [ctx.lead?.business_name, input.notes].filter(Boolean).join(": ") },
      );
      const when = new Date(b.start).toLocaleString("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
      if (ctx.lead) {
        updateLead(ctx.lead.id, { email: input.email, contact_name: ctx.lead.contact_name ?? input.name, status: "interested" });
        appendLeadNote(ctx.lead.id, `Booked a call with ${OWNER} for ${when}.`);
      }
      void notifyAaron(`📅 ${input.name} (${ctx.lead?.business_name ?? "unknown business"}) booked a call with you: ${when}. ${input.notes ?? ""}`);
      return { content: `Booked for ${when}. Cal.com emails them a confirmation.` };
    },
  }),
  tool({
    name: "text_booking_link",
    description: `Text them ${OWNER}'s booking page so they can pick a time themselves.`,
    schema: z.object({ mobile: z.string() }),
    async run({ mobile }, ctx) {
      if (!config.CALCOM_BOOKING_URL) throw new Error("No booking page is set up. Use schedule_callback instead.");
      await textTo(ctx, mobile, `Pick any time that works for a quick call with ${OWNER} (${config.BUSINESS_NAME}): ${config.CALCOM_BOOKING_URL}`);
      return { content: "Texted the booking link." };
    },
  }),
  tool({
    name: "transfer_to_owner",
    description: `Transfer the call live to ${OWNER}'s cell. Say "Let me grab ${OWNER}, one sec" first. If ${OWNER} doesn't pick up, the call comes back to you.`,
    schema: z.object({ reason: z.string().describe("One line for the whisper, e.g. 'wants the website, has questions about hosting'") }),
    async run({ reason }, ctx) {
      if (!config.ALLOW_LIVE_TRANSFER) throw new Error("Live transfer is off. Offer to book a call instead.");
      return { content: "Transferring.", handoff: { action: "transfer", to: config.OWNER_CELL, reason, returnMode: "sales" } };
    },
  }),
  tool({
    name: "schedule_callback",
    description: "They asked to be called back at a specific time (or you should try the owner at a better time).",
    schema: z.object({
      when_local: z.string().describe("Local date and time, YYYY-MM-DDTHH:MM"),
      note: z.string().describe("Who to ask for and why"),
    }),
    async run({ when_local, note }, ctx) {
      const lead = requireLead(ctx);
      const tz = lead.timezone || config.TIMEZONE;
      const at = zonedToUtc(when_local, tz);
      if (!at) throw new Error("Couldn't read that time. Confirm the day and time.");
      updateLead(lead.id, { status: "callback", next_attempt_at: at.toISOString() });
      appendLeadNote(lead.id, `Callback requested for ${when_local} (${tz}): ${note}`);
      return { content: `Callback set for ${when_local}.` };
    },
  }),
  tool({
    name: "update_lead",
    description: "Save details you learned: owner's name, email, cell, what they care about, changes they want to the preview.",
    schema: z.object({
      contact_name: z.string().optional(),
      business_name: z.string().optional().describe("Only when the caller's business isn't on file yet"),
      email: z.string().email().optional(),
      mobile: z.string().optional(),
      note: z.string().optional(),
      pitch: z.enum(["website", "receptionist", "both"]).optional(),
    }),
    async run(input, ctx) {
      let lead = ctx.lead;
      if (!lead && input.business_name) {
        const phone = ctx.call.direction === "outbound" ? ctx.call.to : ctx.call.from;
        const { id } = upsertLead({ business_name: input.business_name, phone, source: "manual" });
        ctx.call.leadId = id;
        lead = getLead(id);
      }
      if (!lead) throw new Error("Ask for their business name first.");
      const mobile = input.mobile ? toE164(input.mobile) : undefined;
      updateLead(lead.id, {
        contact_name: input.contact_name,
        email: input.email,
        mobile: mobile ?? undefined,
        pitch: input.pitch,
      });
      if (input.note) appendLeadNote(lead.id, input.note);
      return { content: "Saved." };
    },
  }),
  markDoNotCallTool,
  voicemailDetectedTool,
  pressKeysTool,
  endCallTool(["interested", "sale_link_sent", "meeting_booked", "callback", "gatekeeper", "not_interested", "wrong_number", "no_decision"]),
];

export function buildSalesAgent(call: CallState, params: Record<string, string>): Agent {
  const lead = call.leadId ? getLead(call.leadId) : undefined;
  let openingCue: Agent["openingCue"];
  if (params.resume === "demo") {
    openingCue = {
      afterMs: 150,
      note: `The live receptionist demo just ended and you're back on the line as ${config.SALES_AGENT_NAME}. Welcome them back and ask what they thought.`,
    };
  } else if (params.resume === "transfer_failed") {
    openingCue = {
      afterMs: 150,
      note: `${OWNER} didn't pick up the transfer. You're back on the line. Apologize briefly and offer to book a call with ${OWNER} or have ${OWNER} call them back.`,
    };
  } else if (call.direction === "outbound") {
    openingCue = {
      afterMs: 3000,
      note: "The call connected but they haven't said anything yet. Open the call now.",
    };
  }
  return {
    mode: "sales",
    system: [
      { type: "text", text: salesPlaybook(), cache_control: { type: "ephemeral" } },
      { type: "text", text: leadDossier(lead, call) },
    ],
    tools: salesTools(),
    openingCue,
  };
}

export function salesInboundGreeting(): string {
  return `Hey, thanks for calling ${config.BUSINESS_NAME}! This is ${config.SALES_AGENT_NAME}, ${OWNER}'s AI assistant. ${OWNER}'s tied up right now. What can I help you with?`;
}

