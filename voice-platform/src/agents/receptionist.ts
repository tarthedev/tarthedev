import { z } from "zod";
import { config } from "../config.js";
import { getLead, getTenant, logEvent, type Lead, type Tenant } from "../db.js";
import { describeLocalNow, toE164 } from "../lib/util.js";
import { formatPhone, offer } from "../offer.js";
import { tool, type Agent, type AgentTool, type CallState, type ToolContext } from "../relay/types.js";
import { createBooking, getSlots, summarizeSlots } from "../tools/calcom.js";
import { notifyOwner } from "../tools/notify.js";
import { sendSms } from "../tools/twilio.js";
import { endCallTool, markDoNotCallTool, VOICE_STYLE } from "./common.js";

/** Everything the receptionist needs to know about the business it answers for. */
export interface ReceptionistProfile {
  businessName: string;
  agentName: string;
  ownerName: string;
  timezone: string;
  knowledge: string;
  transferRules?: string | null;
  canTransfer: boolean;
  canBook: boolean;
  bookingUrl?: string | null;
  greeting: string;
}

function receptionistPrompt(p: ReceptionistProfile, demo: DemoInfo | null): string {
  const demoBlock = demo
    ? `# THIS IS A DEMO
${demo.liveFromSales ? `${config.SALES_AGENT_NAME} (the ${config.BUSINESS_NAME} sales assistant) just switched this call over to you.` : `This call came in on the ${config.BUSINESS_NAME} demo line.`} The caller is most likely the owner of ${p.businessName}, pretending to be a customer to see how you'd handle their calls. Play it completely straight: be their receptionist, and make it impressive: quick, warm, natural, helpful.
- You don't have their real price list, schedule, or full service details yet (in a real setup the owner fills those in). When something isn't in the knowledge below, do what a good receptionist would: ask a qualifying question, then book it or take a message for ${p.ownerName}. Don't invent prices or promises.
- Bookings and messages in the demo are simulated, but the tools tell you what the owner would receive. You can mention it once, lightly: "In the real setup, you'd get a text with this right now."
- If the caller says "end demo", "okay I've heard enough", asks to go back to ${config.SALES_AGENT_NAME}, or clearly steps out of the role-play, use end_demo right away (say something short like "Sure thing!" first).
`
    : "";
  return `You are ${p.agentName}, the virtual receptionist for ${p.businessName}. You answer their phone calls.

${VOICE_STYLE}

# Honesty rules (never break these)
- You're a virtual receptionist, an AI assistant. If a caller asks whether you're a real person or AI, say so plainly and cheerfully, and keep helping.
- Only give information that's in the business knowledge below. If a caller asks something you don't know (a price that isn't listed, whether they can come today, a diagnosis), say you'll have ${p.ownerName} get back to them, and take a message.
- Never promise arrival times, prices, discounts, or outcomes that aren't written below.${demo ? "" : "\n- If a caller asks not to be called or texted again, use mark_do_not_call."}

${demoBlock}# How to handle a call
1. Find out what they need. Get their name early and use it.
2. Answer questions from the business knowledge.
3. New work or an appointment: get their name, the best callback number (confirm the number they're calling from), the address or area if it matters, what they need, and when. ${p.canBook ? "Then check_availability and book_appointment." : "Then take_message so the owner can call back and schedule."}
4. ${p.canTransfer ? `Transfer rules: ${p.transferRules || "transfer only true emergencies, or when the caller insists on speaking to the owner"}. Use transfer_call for those.` : "You can't transfer calls. For urgent situations, take an urgent message; the owner gets it by text immediately."}
5. Before hanging up, say what happens next ("I'll get this to ${p.ownerName} right now"), then end_call. Always finish with end_call.
6. Sales calls, robocalls, and spam: be polite, take a short message only if it seems legitimate, and end the call.

# Greeting
You already answered the phone with: "${p.greeting}". Don't repeat it.

# Business knowledge
${p.knowledge.trim() || "(Nothing on file yet beyond the business name. Take messages for everything.)"}`;
}

interface DemoInfo {
  liveFromSales: boolean;
  lead?: Lead;
  /** Number to send "here's what you'd receive" texts to, if it's a cell. */
  ownerCell?: string | null;
}

function nowBlock(p: ReceptionistProfile, call: CallState) {
  const caller = call.direction === "inbound" ? call.from : call.to;
  return `# Right now
Local time: ${describeLocalNow(p.timezone)}
Caller ID: ${caller ? formatPhone(caller) : "unknown"}`;
}

// ---------- tools ----------

function receptionistTools(p: ReceptionistProfile, tenant: Tenant | undefined, demo: DemoInfo | null): AgentTool[] {
  const callerNumber = (ctx: ToolContext) => (ctx.call.direction === "inbound" ? ctx.call.from : ctx.call.to);
  const smsFrom = tenant?.phone_number ?? undefined;

  const tools: AgentTool[] = [
    tool({
      name: "take_message",
      description: `Send a message to ${p.ownerName} right away (text + email). Use for anything the owner needs to call back about.`,
      schema: z.object({
        caller_name: z.string(),
        callback_number: z.string().describe("Confirmed callback number"),
        reason: z.string().describe("What they need, with any details they gave (address, timing, problem)"),
        urgent: z.boolean().describe("True only for real emergencies or time-sensitive jobs"),
      }),
      async run(m, ctx) {
        ctx.call.messageTaken = true;
        const body = `${m.urgent ? "🚨 URGENT " : ""}New message for ${p.businessName}\nFrom: ${m.caller_name}, ${formatPhone(
          toE164(m.callback_number) ?? m.callback_number,
        )}\nRe: ${m.reason}\n— ${p.agentName}, your AI receptionist`;
        if (demo) {
          if (demo.ownerCell) {
            await sendSms(demo.ownerCell, `${body}\n\n(Demo: this is the text you'd get after a call. Reply STOP to opt out.)`).catch(() => {});
            return { content: "Demo: the owner's phone just got this message as a text. You can mention they should have it now." };
          }
          return { content: "Demo: in the real setup the owner would get this as a text immediately." };
        }
        await notifyOwner({
          cell: tenant?.owner_cell,
          email: tenant?.owner_email,
          sms: body,
          subject: `${m.urgent ? "URGENT: " : ""}Message from ${m.caller_name}`,
          smsFrom,
        });
        logEvent({ type: "message_taken", tenantId: tenant?.id, callSid: ctx.call.callSid, data: m });
        return { content: `Message sent to ${p.ownerName}.` };
      },
    }),
    tool({
      name: "text_caller",
      description: "Text the caller something useful: the address, a booking link, or a confirmation. Keep it short.",
      schema: z.object({ message: z.string().max(480), to: z.string().optional().describe("Only if they want it sent to a different cell") }),
      async run({ message, to }, ctx) {
        const dest = toE164(to ?? callerNumber(ctx));
        if (!dest) throw new Error("No valid cell number to text. Ask for one.");
        await sendSms(dest, `${p.businessName}: ${message}`, smsFrom);
        return { content: "Texted." };
      },
    }),
    ...(demo ? [] : [markDoNotCallTool]),
    endCallTool(["handled", "message_taken", "booked", "transferred", "spam", "hang_up"]),
  ];

  if (p.canBook) {
    tools.push(
      tool({
        name: "check_availability",
        description: "Find open appointment times.",
        schema: z.object({ from_date: z.string().optional().describe("YYYY-MM-DD; defaults to today") }),
        async run({ from_date }) {
          if (demo) {
            return { content: "Demo calendar: tomorrow at 9:00 AM, 11:30 AM, or 2:00 PM; the day after at 10:00 AM or 3:30 PM. Offer two." };
          }
          const start = from_date ? new Date(`${from_date}T00:00:00`) : new Date();
          const slots = await getSlots(
            { apiKey: tenant!.calcom_api_key!, eventTypeId: tenant!.calcom_event_type_id! },
            start.toISOString(),
            new Date(start.getTime() + 7 * 86400_000).toISOString(),
            p.timezone,
          );
          return { content: `Open times; offer two or three. Use the ISO value in parentheses to book.\n${summarizeSlots(slots, p.timezone)}` };
        },
      }),
      tool({
        name: "book_appointment",
        description: "Book an appointment at an open time. Needs name, phone, and email (spell it back). If they won't give an email, take_message instead.",
        schema: z.object({
          start: z.string().describe("ISO time from check_availability"),
          name: z.string(),
          phone: z.string(),
          email: z.string().email(),
          notes: z.string().describe("What the appointment is for, address if relevant"),
        }),
        async run(b, ctx) {
          if (demo) {
            ctx.call.messageTaken = true;
            if (demo.ownerCell) {
              await sendSms(demo.ownerCell, `📅 New booking for ${p.businessName}: ${b.name}, ${b.notes}. (Demo: this is the text you'd get.)`).catch(() => {});
            }
            return { content: "Demo: booked (simulated). Confirm it back to them like a real booking." };
          }
          const r = await createBooking(
            { apiKey: tenant!.calcom_api_key!, eventTypeId: tenant!.calcom_event_type_id! },
            { start: b.start, name: b.name, email: b.email, phone: toE164(b.phone) ?? undefined, timeZone: p.timezone, notes: b.notes },
          );
          ctx.call.messageTaken = true;
          const when = new Date(r.start).toLocaleString("en-US", { timeZone: p.timezone, weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
          await notifyOwner({
            cell: tenant?.owner_cell,
            email: tenant?.owner_email,
            sms: `📅 New booking: ${b.name} (${formatPhone(toE164(b.phone) ?? b.phone)}), ${when}. ${b.notes}`,
            subject: `New booking: ${b.name}, ${when}`,
            smsFrom,
          });
          return { content: `Booked for ${when}. They'll get an email confirmation.` };
        },
      }),
    );
  } else if (p.bookingUrl) {
    tools.push(tool({
      name: "text_booking_link",
      description: "Text the caller the online booking page.",
      schema: z.object({}),
      async run(_i, ctx) {
        const dest = toE164(callerNumber(ctx));
        if (!dest) throw new Error("No cell number to text.");
        await sendSms(dest, `${p.businessName}: book online here: ${p.bookingUrl}`, smsFrom);
        return { content: "Texted the booking link." };
      },
    }));
  }

  if (p.canTransfer || demo) {
    tools.push(tool({
      name: "transfer_call",
      description: `Transfer the caller live to ${p.ownerName}. Say "Let me get ${p.ownerName} for you, one moment" first.`,
      schema: z.object({ reason: z.string().describe("One line the owner hears before the call connects") }),
      async run({ reason }) {
        if (demo) {
          return { content: `Demo: in the real setup this would ring ${p.ownerName}'s cell right now and whisper "${reason}" before connecting. Tell the caller that, then carry on.` };
        }
        return { content: "Transferring.", handoff: { action: "transfer", to: tenant!.owner_cell!, reason, returnMode: "receptionist" } };
      },
    }));
  }

  if (demo) {
    tools.push(tool({
      name: "end_demo",
      description: demo.liveFromSales
        ? `End the role-play and hand the call back to ${config.SALES_AGENT_NAME}.`
        : "End the role-play and the call.",
      schema: z.object({}),
      async run(_i, ctx) {
        logEvent({ type: "demo_finished", leadId: ctx.call.leadId, callSid: ctx.call.callSid });
        return demo.liveFromSales
          ? { content: "Handing back.", handoff: { action: "end_demo" } }
          : { content: "Ending.", handoff: { action: "hangup", reason: "demo finished" } };
      },
    }));
  }
  return tools;
}

// ---------- builders ----------

export function tenantProfile(t: Tenant): ReceptionistProfile {
  return {
    businessName: t.business_name,
    agentName: t.agent_name,
    ownerName: t.owner_name?.split(" ")[0] || "the owner",
    timezone: t.timezone,
    knowledge: t.knowledge,
    transferRules: t.transfer_rules,
    canTransfer: Boolean(t.owner_cell),
    canBook: Boolean(t.calcom_api_key && t.calcom_event_type_id),
    bookingUrl: t.booking_url,
    greeting: tenantGreeting(t),
  };
}

export function tenantGreeting(t: Tenant): string {
  return t.greeting?.trim() || `Thanks for calling ${t.business_name}! This is ${t.agent_name}, the virtual assistant. How can I help you?`;
}

export function buildTenantReceptionist(call: CallState, params: Record<string, string> = {}): Agent {
  const tenant = call.tenantId ? getTenant(call.tenantId) : undefined;
  if (!tenant) throw new Error(`No receptionist client for call ${call.callSid}`);
  const p = tenantProfile(tenant);
  return {
    mode: "receptionist",
    system: [
      { type: "text", text: receptionistPrompt(p, null), cache_control: { type: "ephemeral" } },
      { type: "text", text: nowBlock(p, call) },
    ],
    tools: receptionistTools(p, tenant, null),
    openingCue:
      params.resume === "transfer_failed"
        ? { afterMs: 150, note: `${p.ownerName} couldn't pick up the transfer. You're back on the line. Apologize briefly and take a detailed message (mark it urgent if it is).` }
        : undefined,
  };
}

/** What we know about a prospect's business, written as receptionist knowledge for the demo. */
export function demoKnowledge(lead: Lead): string {
  const lines = [`Business: ${lead.business_name}${lead.category ? `, ${lead.category}` : ""}`];
  if (lead.address) lines.push(`Address: ${lead.address}`);
  if (lead.city) lines.push(`Serves ${lead.city} and the surrounding area.`);
  if (lead.hours_json) {
    const hours = JSON.parse(lead.hours_json) as string[];
    if (hours.length) lines.push(`Hours:\n${hours.join("\n")}`);
  }
  if (lead.rating) lines.push(`${lead.rating} stars on Google from ${lead.review_count ?? 0} reviews.`);
  if (lead.phone) lines.push(`Main number: ${formatPhone(lead.phone)}`);
  if (lead.preview_json) {
    const pv = JSON.parse(lead.preview_json) as { services?: { name: string }[] };
    if (pv.services?.length)
      lines.push(`Services listed on the draft website (typical for this trade, not confirmed by the owner): ${pv.services.map((s) => s.name).join(", ")}`);
  }
  return lines.join("\n");
}

export function strangerGreeting(): string {
  return `Hi! You've reached the ${config.BUSINESS_NAME} AI receptionist demo. What's the name of your business, and what do you do?`;
}

export function demoGreeting(businessName: string): string {
  return `Thanks for calling ${businessName}! This is Sam, the virtual assistant. How can I help you today?`;
}

export function buildDemoReceptionist(call: CallState, params: Record<string, string>): Agent {
  const liveFromSales = params.from === "sales";
  const lead = call.leadId ? getLead(call.leadId) : undefined;
  const businessName = lead?.business_name ?? call.demoBusiness?.name;
  const ownerCell = liveFromSales ? lead?.mobile : call.from;
  const demo: DemoInfo = { liveFromSales, lead, ownerCell };

  if (!businessName) {
    // A stranger on the demo line: find out which business to pretend to be, then restart as that receptionist.
    return {
      mode: "demo",
      system: [
        {
          type: "text",
          text: `You are the ${config.BUSINESS_NAME} AI receptionist demo line. ${config.OWNER_NAME} sets up AI receptionists for local businesses: ${offer.receptionist.pricingNote} ${offer.receptionist.summary}

${VOICE_STYLE}

You already said: "${strangerGreeting()}" Get their business name and what they do, so you can answer the phone as if you worked there. When you have both, say something like "Perfect. Okay, I'm going to answer like I work for <business>. Pretend you're a customer calling in!" and use set_demo_business in the same turn.
If they have questions about pricing or signing up instead, answer only from the facts above and offer to have ${config.OWNER_FIRST_NAME} call them back; get their name and business, use set_demo_business only if they want the demo, otherwise end_call. You're an AI; say so if asked.`,
        },
      ],
      tools: [
        tool({
          name: "set_demo_business",
          description: "Start the role-play as this business's receptionist.",
          schema: z.object({ business_name: z.string(), what_they_do: z.string() }),
          async run(b, ctx) {
            ctx.call.demoBusiness = { name: b.business_name, type: b.what_they_do };
            void notifyOwner({
              cell: config.OWNER_CELL,
              sms: `🎧 Someone is trying the receptionist demo line as "${b.business_name}" (${b.what_they_do}) from ${formatPhone(ctx.call.from)}.`,
            });
            return { content: "Switching into the role.", handoff: { action: "start_demo" } };
          },
        }),
        markDoNotCallTool,
        endCallTool(["demo_question", "not_interested", "hang_up"]),
      ],
    };
  }

  const profile: ReceptionistProfile = {
    businessName,
    agentName: "Sam",
    ownerName: lead?.contact_name?.split(" ")[0] || "the owner",
    timezone: lead?.timezone || config.TIMEZONE,
    knowledge: lead ? demoKnowledge(lead) : `Business: ${businessName}, ${call.demoBusiness?.type ?? ""}`,
    canTransfer: true, // simulated in the demo: the tool explains what would happen
    canBook: true,
    greeting: demoGreeting(businessName),
  };
  return {
    mode: "demo",
    system: [
      { type: "text", text: receptionistPrompt(profile, demo), cache_control: { type: "ephemeral" } },
      { type: "text", text: nowBlock(profile, call) },
    ],
    tools: receptionistTools(profile, undefined, demo).filter((t) => t.name !== "text_caller"),
  };
}
