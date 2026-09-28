import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { consentText } from "../consent.js";
import { findLeadByPhone, logEvent, updateLead, upsertLead } from "../db.js";
import { callWebLeadNow } from "../dialer/dialer.js";
import { enrichLead } from "../leads/pipeline.js";
import { toE164 } from "../lib/util.js";
import { formatPhone, offer } from "../offer.js";
import { notifyAaron } from "../tools/notify.js";

const WebLead = z.object({
  name: z.string().trim().min(1).max(100),
  business: z.string().trim().min(1).max(150),
  phone: z.string().trim().min(7).max(30),
  interest: z.enum(["website", "receptionist", "both"]).default("website"),
  consent: z.union([z.boolean(), z.string()]).transform((v) => v === true || v === "true" || v === "on" || v === "1"),
  consent_text: z.string().max(2000).optional(),
  website: z.string().optional(), // honeypot: real people never fill this in
  started_at: z.coerce.number().optional(), // when the form was rendered (ms); bots submit instantly
  page: z.string().max(300).optional(),
});

// Tiny in-memory rate limit per IP: 5 submissions per hour.
const hits = new Map<string, number[]>();
function limited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 3600_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 5;
}

export async function webRoutes(app: FastifyInstance) {
  /** Numbers and prices the website shows, so they're never out of sync with the platform. */
  app.get("/api/public-config", async () => ({
    demoLine: config.DEMO_LINE_NUMBER ? { e164: config.DEMO_LINE_NUMBER, display: formatPhone(config.DEMO_LINE_NUMBER) } : null,
    receptionist: {
      solo: offer.receptionist.soloMonthly,
      addon: offer.receptionist.addonMonthly,
      minutes: offer.receptionist.minutesIncluded,
    },
    consentText: consentText(),
  }));

  app.post("/api/web-lead", async (req, reply) => {
    const parsed = WebLead.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ ok: false, error: "Please fill in your name, business, and phone number." });
    const f = parsed.data;
    if (f.website) return { ok: true, calling: false, message: "Thanks!" }; // honeypot tripped: pretend success
    if (f.started_at && Date.now() - f.started_at < 2500) return { ok: true, calling: false, message: "Thanks!" };
    if (limited(req.ip)) return reply.code(429).send({ ok: false, error: "Too many requests. Text us instead." });

    const phone = toE164(f.phone);
    if (!phone) return reply.code(400).send({ ok: false, error: "That phone number doesn't look right." });

    const consent = f.consent
      ? JSON.stringify({
          ai_calls: true,
          texts: true,
          text: consentText(),
          shown_text: f.consent_text?.slice(0, 2000) ?? null,
          at: new Date().toISOString(),
          ip: req.ip,
          user_agent: req.headers["user-agent"] ?? null,
          page: f.page ?? req.headers.referer ?? null,
          name: f.name,
          phone,
        })
      : null;

    const existing = findLeadByPhone(phone);
    const { id } = upsertLead({
      business_name: existing?.business_name ?? f.business,
      contact_name: f.name,
      phone: existing?.phone ?? phone,
      mobile: phone,
      pitch: f.interest,
      source: existing?.source ?? "web",
      timezone: existing?.timezone ?? config.TIMEZONE,
      ...(consent ? { consent_json: consent } : {}),
    });
    // They asked us to call: reset attempts so the new request isn't blocked by old cold-call history.
    if (existing && consent) updateLead(id, { attempts: 0, last_attempt_at: null, status: existing.status === "dnc" ? "dnc" : "new" });
    logEvent({ type: "web_lead", leadId: id, data: { interest: f.interest, consent: Boolean(consent) } });

    let result = { calling: false, message: "Thanks! Aaron will be in touch shortly." };
    if (consent) {
      try {
        result = await callWebLeadNow(id);
      } catch (e) {
        req.log.error(e, "web lead call failed");
      }
    }
    void notifyAaron(
      `🌐 Website lead: ${f.name}, ${f.business}, ${formatPhone(phone)} (wants ${f.interest}). ${
        result.calling ? "The AI is calling them now." : consent ? result.message : "No call consent; follow up yourself."
      }`,
    );
    void enrichLead(id, { lookup: false }).catch(() => {});
    return {
      ok: true,
      calling: result.calling,
      message: result.calling
        ? "Calling you now! Pick up; it's our AI assistant."
        : consent
          ? `Got it. ${result.message}.`
          : "Got it. Aaron will be in touch shortly.",
    };
  });
}
