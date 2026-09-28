import { config } from "./config.js";

// The facts the AI is allowed to state about what Rollinson Network sells.
// Website numbers and wording come from rollinsonnetwork.com; receptionist
// pricing is $99/mo for website clients and $149/mo on its own. The agents
// are told never to promise anything that isn't written here.

export const offer = {
  website: {
    listPrice: 2000,
    price: 1200,
    monthly: 129,
    summary: "A five-page website, live in about a week.",
    introNote: "The $1,200 price is the introductory rate for Aaron's first five clients (normally $2,000).",
    monthlyNote: "$129/month after that if they want Aaron to keep it running. No contract, cancel whenever.",
    includes: [
      "Built for a phone first, since that's where most of their traffic is",
      "Tap-to-call on every screen, no forms to fill out",
      "Their services, hours, and service area written in plain English",
      "Google Maps and their reviews pulled in and linked",
      "Their Google Business Profile cleaned up, included, not extra",
      "Hosting and the domain handled by Aaron",
    ],
    process: [
      "Aaron builds a real preview first, with their name, number, and reviews on it, before they spend a dollar",
      "They tell Aaron what's wrong with it (services, hours, colors) and Aaron fixes it",
      "It goes live. They pay when they're happy with it, not before. Usually about a week start to finish",
    ],
  },
  receptionist: {
    addonMonthly: 99,
    soloMonthly: 149,
    minutesIncluded: 500,
    summary:
      "An AI receptionist that answers the business's phone 24/7 in a natural voice, answers questions about their services and hours, takes messages, books appointments, and texts the owner a summary of every call.",
    terms: "No setup fee, no contract. 500 minutes a month included.",
    pricingNote:
      "$99/month for Rollinson Network website clients, $149/month on its own. No setup fee, no contract, cancel anytime.",
    howItWorks: [
      "They keep their existing number and forward it to the AI line when they're busy, after hours, or all the time. Or they use a new local number",
      "It knows their services, hours, service area, and common questions",
      "Urgent calls can be transferred straight to their cell",
      "Every call gets a text summary with the caller's name, number, and what they wanted",
    ],
  },
} as const;

export function offerFactsText(): string {
  const w = offer.website;
  const r = offer.receptionist;
  return [
    `# What ${config.BUSINESS_NAME} sells (the only facts you may state)`,
    "",
    `## Website: $${w.price.toLocaleString()} (normally $${w.listPrice.toLocaleString()})`,
    w.summary,
    w.introNote,
    w.monthlyNote,
    "What's in it:",
    ...w.includes.map((s) => `- ${s}`),
    "How it goes:",
    ...w.process.map((s, i) => `${i + 1}. ${s}`),
    "",
    `## AI receptionist: $${r.soloMonthly}/month, or $${r.addonMonthly}/month for website clients`,
    r.summary,
    r.terms,
    ...r.howItWorks.map((s) => `- ${s}`),
    "",
    `## Who they'd be dealing with`,
    `${config.OWNER_NAME} (pronouns: ${config.OWNER_PRONOUNS}). ${config.OWNER_FIRST_NAME} lives in ${config.HOME_CITY}, sells phones and plans for a living, and spends most of the day explaining technology to people who'd rather not think about it. Serves ${config.SERVICE_AREA}. ${config.OWNER_FIRST_NAME}'s cell: ${formatPhone(config.OWNER_CELL)}. Email: ${config.OWNER_EMAIL}.`,
  ].join("\n");
}

export function formatPhone(e164: string): string {
  const d = e164.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  if (d.length !== 10) return e164;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/** Digits read out loud one group at a time, e.g. "252, 250, 30 44". */
export function speakablePhone(e164: string): string {
  const d = e164.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  if (d.length !== 10) return e164;
  return `${d.slice(0, 3).split("").join(" ")}, ${d.slice(3, 6).split("").join(" ")}, ${d.slice(6).split("").join(" ")}`;
}
