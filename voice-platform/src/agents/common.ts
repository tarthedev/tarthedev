import { z } from "zod";
import { addDnc, appendLeadNote, logEvent } from "../db.js";
import { tool, type AgentTool } from "../relay/types.js";

export const VOICE_STYLE = `# How you talk
You're on a live phone call. Everything you write is spoken out loud by a text-to-speech voice the instant you write it.
- Sound like a real person on the phone: warm, relaxed, plain words, contractions. Short sentences. Usually one or two sentences per turn, then let them talk.
- Ask one question at a time, then stop and wait for the answer.
- React to what they actually said before moving on ("Oh nice." "Yeah, that makes sense." "Gotcha.").
- Never use lists, bullet points, markdown, emojis, stage directions, or anything in brackets or asterisks. Don't read web addresses aloud; say you'll text the link.
- Say numbers the way people say them out loud: "twelve hundred dollars", "a hundred forty-nine a month". Read phone numbers in groups: "two five two, two five oh, three oh four four".
- Speech-to-text makes mistakes. If a word seems off, go with the obvious meaning from context, or just ask: "Sorry, say that one more time?"
- Before a tool that takes a moment (sending a text, checking the calendar), say a quick "One sec." in the same turn.
- Text inside <call_event> tags comes from the phone system, not the caller. Never read it out or mention the tags.
- Latency-sensitive: begin your spoken answer immediately.`;

export function honestyRules(owner: string) {
  return `# Honesty rules (never break these)
- You are an AI assistant. If anyone asks whether you're a real person, a robot, or AI, say plainly that you're an AI assistant. Never claim or imply you're human.
- Only state facts written in these instructions or told to you by the caller. If you don't know something, say you'll have ${owner} follow up. Never guess.
- Never make up prices, discounts, guarantees, refund terms, timelines, or availability.
- If someone says they don't want calls, asks to be taken off the list, or says to stop calling: apologize, confirm they won't be called again, use mark_do_not_call, and say goodbye.`;
}

export function endCallTool(outcomes: readonly [string, ...string[]]): AgentTool {
  return tool({
    name: "end_call",
    description:
      "Hang up after your goodbye. Say your goodbye in the same turn, before calling this. Always end calls with this tool.",
    schema: z.object({
      outcome: z.enum(outcomes).describe("How the call ended"),
      summary: z.string().describe("Two or three sentences for the owner: who you talked to, what they want, next step."),
    }),
    async run(input, ctx) {
      ctx.call.outcome = input.outcome;
      ctx.call.summary = input.summary;
      return { content: "Ending the call.", handoff: { action: "hangup", reason: input.outcome } };
    },
  });
}

export const markDoNotCallTool: AgentTool = tool({
  name: "mark_do_not_call",
  description:
    "The person asked not to be called again (or to be removed from the list). Records it permanently and ends the call. Apologize and say goodbye in the same turn first.",
  schema: z.object({}),
  async run(_input, ctx) {
    const numbers = [ctx.call.direction === "outbound" ? ctx.call.to : ctx.call.from, ctx.lead?.mobile].filter(
      (n): n is string => Boolean(n),
    );
    for (const n of numbers) addDnc(n, "asked on call", `call:${ctx.call.callSid}`);
    if (ctx.lead) appendLeadNote(ctx.lead.id, "Asked not to be called again. Added to do-not-call list.");
    logEvent({ type: "dnc", leadId: ctx.lead?.id, callSid: ctx.call.callSid });
    ctx.call.outcome = "dnc";
    return { content: "Added to the do-not-call list. Ending the call.", handoff: { action: "hangup", reason: "dnc" } };
  },
});

export const pressKeysTool: AgentTool = tool({
  name: "press_keys",
  description:
    "Press keypad digits to get through an automated phone menu (e.g. 'press 1 for the office'). Use only for automated menus.",
  schema: z.object({ digits: z.string().regex(/^[0-9*#w]{1,12}$/).describe("Digits to press, e.g. '1' or '0'") }),
  async run(input, ctx) {
    ctx.sendDigits(input.digits);
    return { content: `Pressed ${input.digits}.`, silent: true };
  },
});

export const voicemailDetectedTool: AgentTool = tool({
  name: "voicemail_detected",
  description:
    "What you're hearing is an answering machine or voicemail greeting, not a live person. Call this without saying anything. The system will leave the message at the beep.",
  schema: z.object({}),
  async run(_input, ctx) {
    ctx.call.voicemailSuspected = true;
    return { content: "Noted. Stay silent.", silent: true };
  },
});
