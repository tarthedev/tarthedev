import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { findLeadBySlug, logEvent, nowIso, updateLead } from "../db.js";
import { escapeHtml } from "../lib/util.js";
import { formatPhone } from "../offer.js";
import { liveCallForLead, noteForCall } from "../relay/calls.js";
import { notifyAaron } from "../tools/notify.js";
import type { PreviewData } from "./generate.js";
import { renderPreview, simplePage } from "./render.js";

export async function previewRoutes(app: FastifyInstance) {
  app.get("/p/:slug", async (req, reply) => {
    const lead = findLeadBySlug((req.params as { slug: string }).slug);
    if (!lead?.preview_json) {
      return reply.code(404).type("text/html").send(simplePage("Preview not found", "<p>This preview link has expired or doesn't exist.</p>"));
    }
    return reply
      .type("text/html")
      .header("Cache-Control", "no-store")
      .send(renderPreview(lead, JSON.parse(lead.preview_json) as PreviewData));
  });

  // Fired by a script on the preview page after it's been open a moment.
  app.post("/p/:slug/view", async (req) => {
    const lead = findLeadBySlug((req.params as { slug: string }).slug);
    if (!lead) return { ok: false };
    const first = !lead.preview_views;
    const lastSeen = lead.preview_last_viewed_at ? new Date(lead.preview_last_viewed_at).getTime() : 0;
    updateLead(lead.id, { preview_views: lead.preview_views + 1, preview_last_viewed_at: nowIso() });
    logEvent({ type: "preview_viewed", leadId: lead.id });

    const live = liveCallForLead(lead.id);
    if (live) {
      noteForCall(live.callSid, "They just opened the preview website on their phone. If they haven't said so yet, ask what they think.");
    } else if (first || Date.now() - lastSeen > 6 * 3600_000) {
      void notifyAaron(`👀 ${lead.business_name} just opened their website preview${first ? " for the first time" : " again"}. Good time to call: ${lead.phone ? formatPhone(lead.phone) : ""}`);
    }
    return { ok: true };
  });

  app.get("/thanks", async (req, reply) => {
    const canceled = Boolean((req.query as { canceled?: string }).canceled);
    const body = canceled
      ? `<p>No problem, nothing was charged. Questions? Text ${escapeHtml(config.OWNER_FIRST_NAME)} at <a href="sms:${config.OWNER_CELL}">${escapeHtml(formatPhone(config.OWNER_CELL))}</a>.</p>`
      : `<p>Payment received. ${escapeHtml(config.OWNER_FIRST_NAME)} will text you shortly to get started.</p><p>Questions anytime: <a href="sms:${config.OWNER_CELL}">${escapeHtml(formatPhone(config.OWNER_CELL))}</a> · <a href="mailto:${escapeHtml(config.OWNER_EMAIL)}">${escapeHtml(config.OWNER_EMAIL)}</a></p>`;
    return reply.type("text/html").send(simplePage(canceled ? "Checkout canceled" : "You're all set. Thank you!", body));
  });
}
