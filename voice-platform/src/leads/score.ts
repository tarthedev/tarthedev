import type { Lead } from "../db.js";

// Trades and appointment businesses lose the most money to missed calls.
const RECEPTIONIST_FIT = [
  "plumb", "hvac", "heating", "air condition", "roof", "electric", "contractor", "landscap", "lawn", "pest",
  "locksmith", "tow", "auto repair", "mechanic", "body shop", "dent", "chiropract", "salon", "barber", "spa",
  "lawyer", "attorney", "clean", "pressure wash", "tree", "moving", "mover", "garage door", "pool", "septic",
  "well", "paint", "floor", "fence", "gutter", "handyman", "remodel", "veterinar", "insurance", "real estate",
];

export function receptionistFit(category: string | null | undefined): boolean {
  const c = (category ?? "").toLowerCase();
  return RECEPTIONIST_FIT.some((k) => c.includes(k));
}

export function scoreLead(l: Pick<Lead, "website_status" | "review_count" | "rating" | "category" | "line_type">): {
  score: number;
  pitch: "website" | "receptionist" | "both";
} {
  let score = 0;
  switch (l.website_status) {
    case "none":
      score += 50;
      break;
    case "social_only":
    case "broken":
      score += 45;
      break;
    case "outdated":
      score += 30;
      break;
    case "ok":
      score += 5;
      break;
  }
  const reviews = l.review_count ?? 0;
  if (reviews >= 50) score += 15;
  else if (reviews >= 15) score += 10;
  else if (reviews >= 5) score += 5;
  if ((l.rating ?? 0) >= 4) score += 5;

  const fit = receptionistFit(l.category);
  if (fit) score += 10;
  if (l.line_type === "landline" || l.line_type === "fixedVoip") score += 5;

  const needsSite = l.website_status !== "ok";
  let pitch: "website" | "receptionist" | "both" = "website";
  if (!needsSite && fit) pitch = "receptionist";
  else if (needsSite && fit && reviews >= 30) pitch = "both";
  if (!needsSite && fit) score += 20;

  return { score: Math.min(score, 100), pitch };
}
