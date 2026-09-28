import { z } from "zod";
import { config, publicUrl } from "../config.js";
import { getLead, logEvent, updateLead, type Lead } from "../db.js";
import { randomId, slugify } from "../lib/util.js";
import { generateStructured } from "../llm.js";
import { formatPhone } from "../offer.js";
import { placeReviews, type PlaceReview } from "../leads/places.js";
import { sendEmail } from "../tools/email.js";
import { sendSms } from "../tools/twilio.js";

export const THEMES = ["forest", "navy", "brick", "slate", "teal", "amber", "plum"] as const;

const CopySchema = z.object({
  headline: z.string().describe("Hero headline, at most 9 words. Plain and specific to the trade and town."),
  subheadline: z.string().describe("One sentence under the headline, at most 25 words."),
  services: z
    .array(z.object({ name: z.string(), description: z.string().describe("One plain sentence") }))
    .describe("4 to 6 services typical for this kind of business, named generically"),
  about: z.string().describe("2 to 3 sentences. Only facts from the input; no invented history, licenses, or awards."),
  service_area: z.string().describe("One sentence naming the town and nearby area"),
  highlights: z.array(z.string()).describe("3 short trust points, each under 8 words, based only on the input facts"),
  faq: z
    .array(z.object({ question: z.string(), answer: z.string() }))
    .describe("3 questions a customer would ask, answered only with facts from the input (call/text us, hours, area)"),
  review_quotes: z
    .array(z.object({ author: z.string(), quote: z.string() }))
    .describe("Up to 3 short excerpts copied word for word from the reviews provided. Empty if none."),
  theme: z.enum(THEMES).describe("Color theme that suits the trade"),
});

export type PreviewCopy = z.infer<typeof CopySchema>;

export interface PreviewData {
  copy: PreviewCopy;
  reviews: { author: string; quote: string; rating: number }[];
  generatedAt: string;
}

const SYSTEM = `You write website copy for small local businesses. The copy goes on a free preview website that a local web designer builds before ever talking to the owner, so it has to be accurate and it has to sound like the owner's own business, not an agency.

Rules:
- Plain, friendly, confident English. Short sentences. No hype words (premier, world-class, unparalleled, cutting-edge, one-stop shop).
- Never invent facts: no years in business, founding dates, licenses, certifications, insurance, awards, warranties, guarantees, prices, free estimates, staff or owner names, or "family-owned" unless the input says so.
- Services: the common services for this kind of business, named generically (e.g. "Roof repair", "Drain cleaning").
- Review excerpts must be copied exactly from the reviews given (a sentence or phrase), with the reviewer's name as given.`;

function factsFor(lead: Lead, reviews: PlaceReview[]): string {
  const hours = lead.hours_json ? (JSON.parse(lead.hours_json) as string[]).join("; ") : "not listed";
  return [
    `Business name: ${lead.business_name}`,
    `Kind of business: ${lead.category ?? "local business"}`,
    `Town: ${[lead.city, lead.state].filter(Boolean).join(", ") || config.HOME_CITY + ", NC"}`,
    `Address: ${lead.address ?? "not listed"}`,
    `Phone: ${lead.phone ? formatPhone(lead.phone) : "not listed"}`,
    `Hours: ${hours}`,
    `Google rating: ${lead.rating ? `${lead.rating} stars from ${lead.review_count} reviews` : "not listed"}`,
    "",
    reviews.length
      ? `Reviews:\n${reviews.map((r) => `- ${r.author} (${r.rating} stars): ${r.text}`).join("\n")}`
      : "Reviews: none available",
  ].join("\n");
}

export function previewUrl(lead: Pick<Lead, "preview_slug">): string {
  return publicUrl(`/p/${lead.preview_slug}`);
}

/** Build (or rebuild) the preview site for a lead. Takes ~10-30 seconds. */
export async function buildPreview(leadId: number): Promise<Lead> {
  const lead = getLead(leadId);
  if (!lead) throw new Error(`Lead ${leadId} not found`);
  let reviews: PlaceReview[] = lead.reviews_json ? JSON.parse(lead.reviews_json) : [];
  if (!lead.reviews_json && lead.place_id) {
    reviews = await placeReviews(lead.place_id).catch((e) => {
      console.error("[preview] reviews failed", e.message);
      return [];
    });
    updateLead(leadId, { reviews_json: JSON.stringify(reviews) });
  }
  const copy = await generateStructured({
    schema: CopySchema,
    system: SYSTEM,
    prompt: `Write the preview website copy for this business.\n\n${factsFor(lead, reviews)}`,
    effort: "medium",
  });
  // Keep only review excerpts that really appear in a real review.
  const verified = copy.review_quotes
    .map((q) => {
      const src = reviews.find((r) => r.author === q.author && r.text.includes(q.quote.trim()));
      return src ? { author: src.author, quote: q.quote.trim(), rating: src.rating } : null;
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x));
  const data: PreviewData = { copy, reviews: verified, generatedAt: new Date().toISOString() };
  const slug = lead.preview_slug ?? `${slugify(lead.business_name) || "preview"}-${randomId(2)}`;
  updateLead(leadId, { preview_slug: slug, preview_json: JSON.stringify(data) });
  logEvent({ type: "preview_built", leadId });
  return getLead(leadId)!;
}

const inFlight = new Map<number, Promise<Lead>>();

/** Build once even if several callers ask at the same time. */
export function ensurePreview(leadId: number): Promise<Lead> {
  const lead = getLead(leadId);
  if (lead?.preview_slug && lead.preview_json) return Promise.resolve(lead);
  const existing = inFlight.get(leadId);
  if (existing) return existing;
  const p = buildPreview(leadId).finally(() => inFlight.delete(leadId));
  inFlight.set(leadId, p);
  return p;
}

/** Build in the background during a call, then text/email the link when ready. */
export function buildPreviewInBackground(leadId: number, deliver: { textTo?: string; emailTo?: string }) {
  ensurePreview(leadId)
    .then(async (lead) => {
      const url = previewUrl(lead);
      if (deliver.textTo) {
        await sendSms(
          deliver.textTo,
          `Hi, it's ${config.SALES_AGENT_NAME}, ${config.OWNER_FIRST_NAME}'s AI assistant at ${config.BUSINESS_NAME}. Here's the free website preview for ${lead.business_name}: ${url}\nNo charge. Reply STOP to opt out.`,
        );
      }
      if (deliver.emailTo) {
        await sendEmail({
          to: deliver.emailTo,
          replyTo: config.OWNER_EMAIL,
          subject: `Your free website preview for ${lead.business_name}`,
          html: `<p>Here's the preview ${config.OWNER_FIRST_NAME} built for ${lead.business_name}: <a href="${url}">${url}</a></p><p>No charge. Reply with anything you'd change.</p>`,
        });
      }
      logEvent({ type: "preview_texted", leadId });
    })
    .catch((e) => console.error(`[preview] background build for lead ${leadId} failed:`, e));
}
