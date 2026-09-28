import type { FastifyInstance } from "fastify";
import type Stripe from "stripe";
import { config, publicUrl } from "../config.js";
import { appendLeadNote, getLead, logEvent, saveTenant, updateLead } from "../db.js";
import { slugify } from "../lib/util.js";
import { offer } from "../offer.js";
import { notifyAaron } from "../tools/notify.js";
import { stripeClient } from "../tools/stripe.js";

export async function stripeRoutes(app: FastifyInstance) {
  // Stripe signs the raw body, so this route keeps it unparsed.
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => done(null, body));

  app.post("/stripe/webhook", async (req, reply) => {
    if (!config.STRIPE_WEBHOOK_SECRET) return reply.code(503).send("Stripe webhook secret not configured");
    let event: Stripe.Event;
    try {
      event = stripeClient().webhooks.constructEvent(
        req.body as Buffer,
        req.headers["stripe-signature"] as string,
        config.STRIPE_WEBHOOK_SECRET,
      );
    } catch (e) {
      req.log.warn(e, "bad Stripe signature");
      return reply.code(400).send("bad signature");
    }

    if (event.type === "checkout.session.completed") {
      const s = event.data.object as Stripe.Checkout.Session;
      const leadId = Number(s.metadata?.lead_id ?? s.client_reference_id);
      const product = s.metadata?.product ?? "unknown";
      const lead = leadId ? getLead(leadId) : undefined;
      const amount = ((s.amount_total ?? 0) / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
      if (lead) {
        const website = product === "website" || product === "website_and_receptionist";
        updateLead(lead.id, {
          status: "won",
          is_client: website ? 1 : lead.is_client,
          email: lead.email ?? s.customer_details?.email ?? null,
        });
        appendLeadNote(lead.id, `PAID ${amount} for ${product} (Stripe ${s.id}).`);
        if (product.includes("receptionist")) {
          // Draft receptionist account, switched off until Aaron fills in the details and assigns a number.
          saveTenant({
            business_name: lead.business_name,
            slug: `${slugify(lead.business_name)}-${lead.id}`,
            owner_name: lead.contact_name ?? s.customer_details?.name ?? null,
            owner_cell: lead.mobile ?? null,
            owner_email: s.customer_details?.email ?? lead.email ?? null,
            timezone: lead.timezone ?? config.TIMEZONE,
            plan: product === "receptionist" ? "solo" : "addon",
            minutes_included: offer.receptionist.minutesIncluded,
            active: 0,
            lead_id: lead.id,
            stripe_customer_id: typeof s.customer === "string" ? s.customer : null,
            stripe_subscription_id: typeof s.subscription === "string" ? s.subscription : null,
            knowledge: [
              `Business: ${lead.business_name}${lead.category ? ` (${lead.category})` : ""}`,
              lead.address ? `Address: ${lead.address}` : "",
              lead.hours_json ? `Hours:\n${(JSON.parse(lead.hours_json) as string[]).join("\n")}` : "",
              "Services: (fill in)",
              "Service area: (fill in)",
            ]
              .filter(Boolean)
              .join("\n"),
          });
        }
      }
      logEvent({ type: "payment", leadId: lead?.id, data: { product, amount, session: s.id } });
      await notifyAaron(
        `💰 PAID: ${lead?.business_name ?? s.customer_details?.name ?? "someone"} paid ${amount} for ${product}. ${
          lead ? publicUrl(`/admin/leads/${lead.id}`) : ""
        }${product.includes("receptionist") ? " A draft receptionist account is waiting for you in the dashboard." : ""}`,
      );
    }
    return { received: true };
  });
}
