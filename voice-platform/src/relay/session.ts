import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { WebSocket } from "ws";
import { buildAgent } from "../agents/index.js";
import { config } from "../config.js";
import { getLead, getTenant, logEvent, upsertCall } from "../db.js";
import { estimateSpeechMs } from "../lib/util.js";
import { anthropic, FALLBACK_BETA, historyContent, type ToolParam, type ToolResultBlockParam, type ToolUseBlock } from "../llm.js";
import { startRecording } from "../tools/twilio.js";
import { addTranscript, createCall, getCallState } from "./calls.js";
import type { Agent, AgentMode, CallState, Handoff, ToolContext } from "./types.js";

const MAX_TOOL_STEPS = 6;
const IDLE_CHECK_MS = 14_000;

interface SetupMessage {
  type: "setup";
  callSid: string;
  from: string;
  to: string;
  direction?: string;
  customParameters?: Record<string, string>;
}

type Inbound =
  | SetupMessage
  | { type: "prompt"; voicePrompt: string; last?: boolean; lang?: string }
  | { type: "interrupt"; utteranceUntilInterrupt?: string; durationUntilInterruptMs?: number }
  | { type: "dtmf"; digit: string }
  | { type: "error"; description?: string }
  | { type: string; [k: string]: unknown };

/** Model-specific request settings. Opus/Sonnet/Fable use adaptive thinking + effort; Haiku 4.5 takes neither. */
export function modelParams(model: string, effort: "low" | "medium" | "high") {
  const isHaiku = model.startsWith("claude-haiku");
  const supportsFallback = /^claude-(opus-5|fable-5)/.test(model);
  return {
    ...(isHaiku ? {} : { thinking: { type: "adaptive" as const }, output_config: { effort } }),
    ...(supportsFallback ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
  };
}

function toolParams(agent: Agent): ToolParam[] {
  return agent.tools.map((t) => {
    const { $schema: _ignored, ...schema } = z.toJSONSchema(t.schema) as Record<string, unknown>;
    return {
      name: t.name,
      description: t.description,
      input_schema: schema as ToolParam["input_schema"],
      eager_input_streaming: true,
    };
  });
}

/**
 * One ConversationRelay WebSocket = one AI "session" on a phone call.
 * A single call can have several sessions (sales rep -> live demo -> back to sales).
 */
export class RelaySession {
  private call?: CallState;
  private agent?: Agent;
  private tools: ToolParam[] = [];
  private queue: Promise<void> = Promise.resolve();
  private turn?: { ac: AbortController };
  private speakingUntil = 0;
  private cueTimer?: NodeJS.Timeout;
  private idleTimer?: NodeJS.Timeout;
  private idleChecks = 0;
  private ending = false;
  private closed = false;

  constructor(
    private ws: WebSocket,
    private auth: { cs: string; m: AgentMode },
  ) {
    ws.on("message", (raw) => {
      let msg: Inbound;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      this.handle(msg).catch((err) => console.error("[relay] handler error", err));
    });
    ws.on("close", () => this.onClose());
  }

  private send(obj: Record<string, unknown>) {
    if (this.closed || this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(JSON.stringify(obj));
  }

  private async handle(msg: Inbound) {
    switch (msg.type) {
      case "setup":
        return this.onSetup(msg as SetupMessage);
      case "prompt": {
        const m = msg as { voicePrompt: string; last?: boolean };
        if (m.last === false || !m.voicePrompt?.trim()) return;
        return this.enqueue(m.voicePrompt.trim(), false);
      }
      case "interrupt":
        return this.onInterrupt((msg as { utteranceUntilInterrupt?: string }).utteranceUntilInterrupt ?? "");
      case "dtmf":
        return this.enqueue(`(The caller pressed ${(msg as { digit: string }).digit} on their keypad.)`, true);
      case "error":
        console.error("[relay] twilio error", (msg as { description?: string }).description);
        return;
      default:
        return;
    }
  }

  private async onSetup(msg: SetupMessage) {
    if (msg.callSid !== this.auth.cs) {
      console.warn("[relay] call sid mismatch; closing");
      this.ws.close();
      return;
    }
    const p = msg.customParameters ?? {};
    const mode = (p.mode as AgentMode) ?? this.auth.m;
    this.call =
      getCallState(msg.callSid) ??
      createCall({
        callSid: msg.callSid,
        direction: msg.direction === "outbound-api" || p.direction === "outbound" ? "outbound" : "inbound",
        kind: mode,
        from: msg.from,
        to: msg.to,
        leadId: p.leadId ? Number(p.leadId) : undefined,
        tenantId: p.tenantId ? Number(p.tenantId) : undefined,
      });
    this.agent = buildAgent(mode, this.call, p);
    this.tools = toolParams(this.agent);
    addTranscript(this.call, "system", `AI session started (${mode})`, mode);

    if (mode === "sales" && config.RECORD_SALES_CALLS && !this.call.flags.recording && this.call.direction === "inbound") {
      this.call.flags.recording = true;
      startRecording(this.call.callSid).catch((e) => console.error("[relay] recording failed", e.message));
    }
    if (this.agent.hangupAfterMs) {
      setTimeout(() => this.endSession({ action: "hangup", reason: "voicemail left" }), this.agent.hangupAfterMs);
      return;
    }
    const cue = this.agent.openingCue;
    if (cue) this.cueTimer = setTimeout(() => this.enqueue(cue.note, true), cue.afterMs);
  }

  private onInterrupt(heard: string) {
    this.speakingUntil = Date.now();
    this.turn?.ac.abort();
    if (this.call && heard) {
      this.call.pendingNotes.push(`The caller talked over you. They heard you up to: "${heard.slice(-300)}"`);
    }
  }

  /** New caller speech (or a system cue) always cancels whatever the AI was in the middle of saying. */
  private enqueue(text: string, synthetic: boolean) {
    if (!this.call || !this.agent || this.ending) return;
    if (this.cueTimer) clearTimeout(this.cueTimer);
    this.cueTimer = undefined;
    if (!synthetic) this.idleChecks = 0;
    this.clearIdle();
    this.turn?.ac.abort();
    this.queue = this.queue.then(() => this.runTurn(text, synthetic)).catch((e) => console.error("[relay] turn", e));
  }

  private async runTurn(text: string, synthetic: boolean) {
    const call = this.call!;
    const agent = this.agent!;
    if (this.ending || this.closed) return;
    const history = (call.histories[agent.mode] ??= []);
    const notes = call.pendingNotes.splice(0);
    const parts = notes.map((n) => `<call_event>${n}</call_event>`);
    parts.push(synthetic ? `<call_event>${text}</call_event>` : text);
    history.push({ role: "user", content: parts.join("\n") });
    if (!synthetic) addTranscript(call, "caller", text, agent.mode);

    const turn = { ac: new AbortController() };
    this.turn = turn;
    let parseRetries = 0;
    try {
      for (let step = 0; step < MAX_TOOL_STEPS; step++) {
        let said = "";
        const stream = anthropic().beta.messages.stream(
          {
            model: config.VOICE_MODEL,
            max_tokens: 2048,
            system: agent.system,
            tools: this.tools,
            messages: history,
            cache_control: { type: "ephemeral" },
            ...modelParams(config.VOICE_MODEL, config.VOICE_EFFORT),
          },
          { signal: turn.ac.signal, timeout: 25_000 },
        );
        stream.on("text", (delta) => {
          if (turn.ac.signal.aborted) return;
          said += delta;
          this.send({ type: "text", token: delta, last: false });
        });

        let message;
        try {
          message = await stream.finalMessage();
        } catch (err) {
          if (turn.ac.signal.aborted) {
            // Keep what the caller actually heard; the interrupt note explains the rest.
            if (said.trim()) {
              history.push({ role: "assistant", content: [{ type: "text", text: said }] });
              addTranscript(call, "agent", `${said} [cut off]`, agent.mode);
            }
            return;
          }
          // A tool input that isn't parseable JSON: re-issue the step (API errors are real failures).
          if (!(err instanceof Anthropic.APIError) && parseRetries++ < 1 && !said) continue;
          throw err;
        }

        this.send({ type: "text", token: "", last: true });
        history.push({ role: "assistant", content: historyContent(message.content) });
        if (said.trim()) {
          addTranscript(call, "agent", said.trim(), agent.mode);
          this.speakingUntil = Math.max(Date.now(), this.speakingUntil) + estimateSpeechMs(said);
        }
        logUsage(call.callSid, message.usage);

        if (message.stop_reason === "refusal") {
          this.say("Sorry, I can't help with that one. Is there anything else I can do for you?");
          return;
        }
        const toolUses = message.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
        if (!toolUses.length) return;
        if (message.stop_reason === "max_tokens") throw new Error("tool input truncated at max_tokens");

        const results = await Promise.all(toolUses.map((tu) => this.runTool(tu)));
        history.push({ role: "user", content: results.map((r) => r.block) });

        const handoff = results.find((r) => r.handoff)?.handoff;
        if (handoff) {
          await this.endSession(handoff);
          return;
        }
        if (results.every((r) => r.silent)) return;
        if (turn.ac.signal.aborted) return;
      }
    } catch (err) {
      console.error("[relay] turn failed", err);
      logEvent({ type: "ai_error", callSid: call.callSid, leadId: call.leadId, data: String(err) });
      if (!turn.ac.signal.aborted) this.say("Sorry, you cut out for a second there. Could you say that one more time?");
    } finally {
      if (this.turn === turn) {
        this.turn = undefined;
        this.armIdle();
      }
    }
  }

  private async runTool(tu: ToolUseBlock) {
    const agent = this.agent!;
    const call = this.call!;
    const tool = agent.tools.find((t) => t.name === tu.name);
    const fail = (content: string) => ({
      block: { type: "tool_result", tool_use_id: tu.id, content, is_error: true } as ToolResultBlockParam,
      handoff: undefined as Handoff | undefined,
      silent: false,
    });
    if (!tool) return fail(`Unknown tool ${tu.name}`);
    const parsed = tool.schema.safeParse(tu.input);
    if (!parsed.success) return fail(`Invalid input: ${parsed.error.message}. Input was ${JSON.stringify(tu.input)}`);
    const ctx: ToolContext = {
      call,
      lead: call.leadId ? getLead(call.leadId) : undefined,
      tenant: call.tenantId ? getTenant(call.tenantId) : undefined,
      sendDigits: (digits) => this.send({ type: "sendDigits", digits }),
    };
    try {
      const r = await tool.run(parsed.data, ctx);
      logEvent({ type: `tool:${tu.name}`, callSid: call.callSid, leadId: call.leadId, tenantId: call.tenantId, data: { input: tu.input, result: r.content } });
      addTranscript(call, "system", `[${tu.name}] ${r.content.slice(0, 300)}`, agent.mode);
      return {
        block: { type: "tool_result", tool_use_id: tu.id, content: r.content, is_error: r.isError } as ToolResultBlockParam,
        handoff: r.handoff,
        silent: Boolean(r.silent),
      };
    } catch (err) {
      console.error(`[relay] tool ${tu.name} failed`, err);
      return fail(`That didn't work: ${(err as Error).message}. Tell the caller plainly and offer an alternative.`);
    }
  }

  /** Speak a fixed line (errors, fallbacks) without calling the model. */
  private say(text: string) {
    this.send({ type: "text", token: text, last: true });
    this.speakingUntil = Math.max(Date.now(), this.speakingUntil) + estimateSpeechMs(text);
    if (this.call) addTranscript(this.call, "agent", text, this.agent?.mode);
  }

  /** Let the last words finish playing, then hand the call back to Twilio with instructions. */
  private async endSession(handoff: Handoff) {
    if (this.ending || !this.call) return;
    this.ending = true;
    this.clearIdle();
    const wait = Math.min(Math.max(this.speakingUntil - Date.now(), 0) + 400, 20_000);
    await new Promise((r) => setTimeout(r, wait));
    this.call.flags.lastHandoff = handoff;
    addTranscript(this.call, "system", `AI session ended: ${handoff.action}`, this.agent?.mode);
    this.send({ type: "end", handoffData: JSON.stringify(handoff) });
  }

  private armIdle() {
    this.clearIdle();
    if (this.ending || this.closed || !this.agent || this.agent.mode === "voicemail") return;
    if (this.call?.voicemailSuspected) {
      // Answering-machine detection normally redirects us to the voicemail drop; hang up if it never does.
      this.idleTimer = setTimeout(() => void this.endSession({ action: "hangup", reason: "voicemail" }), 45_000);
      return;
    }
    const delay = Math.max(this.speakingUntil - Date.now(), 0) + IDLE_CHECK_MS;
    this.idleTimer = setTimeout(() => {
      this.idleChecks++;
      if (this.idleChecks > 2) return void this.endSession({ action: "hangup", reason: "silence" });
      this.enqueue(
        this.idleChecks === 1
          ? "The line has been quiet for a while. Briefly check whether they're still there."
          : "Still no response. Say a short, friendly goodbye and end the call with the end_call tool.",
        true,
      );
    }, delay);
  }

  private clearIdle() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  private onClose() {
    this.closed = true;
    this.clearIdle();
    if (this.cueTimer) clearTimeout(this.cueTimer);
    this.turn?.ac.abort();
    if (this.call) upsertCall({ call_sid: this.call.callSid, transcript_json: JSON.stringify(this.call.transcript) });
  }
}

function logUsage(callSid: string, usage: Anthropic.Beta.Messages.BetaUsage) {
  if (process.env.LOG_USAGE !== "1") return;
  console.log(
    `[usage] ${callSid} in=${usage.input_tokens} cache_read=${usage.cache_read_input_tokens ?? 0} cache_write=${
      usage.cache_creation_input_tokens ?? 0
    } out=${usage.output_tokens}`,
  );
}
