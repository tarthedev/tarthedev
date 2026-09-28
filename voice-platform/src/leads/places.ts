import { config } from "../config.js";
import type { LeadInsert } from "../db.js";
import { toE164 } from "../lib/util.js";

// Google Places API (New). Text Search with website + phone fields bills at the
// Enterprise SKU; see docs/SETUP.md for current pricing and the free monthly allowance.
const SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const SEARCH_FIELDS = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.addressComponents",
  "places.nationalPhoneNumber",
  "places.internationalPhoneNumber",
  "places.websiteUri",
  "places.rating",
  "places.userRatingCount",
  "places.primaryTypeDisplayName",
  "places.businessStatus",
  "places.googleMapsUri",
  "places.regularOpeningHours",
  "nextPageToken",
].join(",");

interface PlaceResult {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  addressComponents?: { longText: string; shortText: string; types: string[] }[];
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  primaryTypeDisplayName?: { text: string };
  businessStatus?: string;
  googleMapsUri?: string;
  regularOpeningHours?: { weekdayDescriptions?: string[] };
}

export interface FoundPlace {
  lead: LeadInsert;
  operational: boolean;
}

function mapPlace(p: PlaceResult): FoundPlace {
  const comp = (type: string, short = false) => {
    const c = p.addressComponents?.find((a) => a.types.includes(type));
    return c ? (short ? c.shortText : c.longText) : null;
  };
  return {
    operational: !p.businessStatus || p.businessStatus === "OPERATIONAL",
    lead: {
      place_id: p.id,
      business_name: p.displayName?.text ?? "Unknown business",
      category: p.primaryTypeDisplayName?.text ?? null,
      phone: toE164(p.internationalPhoneNumber ?? p.nationalPhoneNumber),
      address: p.formattedAddress ?? null,
      city: comp("locality") ?? comp("postal_town"),
      state: comp("administrative_area_level_1", true),
      website: p.websiteUri ?? null,
      rating: p.rating ?? null,
      review_count: p.userRatingCount ?? 0,
      maps_url: p.googleMapsUri ?? null,
      hours_json: p.regularOpeningHours?.weekdayDescriptions
        ? JSON.stringify(p.regularOpeningHours.weekdayDescriptions)
        : null,
      source: "places",
    },
  };
}

/** e.g. searchPlaces("roofing contractor in Elizabeth City, NC", 60) */
export async function searchPlaces(textQuery: string, maxResults = 60): Promise<FoundPlace[]> {
  if (!config.GOOGLE_PLACES_API_KEY) throw new Error("GOOGLE_PLACES_API_KEY is not set");
  const out: FoundPlace[] = [];
  let pageToken: string | undefined;
  do {
    const res = await fetch(SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": config.GOOGLE_PLACES_API_KEY,
        "X-Goog-FieldMask": SEARCH_FIELDS,
      },
      body: JSON.stringify({ textQuery, pageSize: 20, regionCode: "US", ...(pageToken ? { pageToken } : {}) }),
    });
    if (!res.ok) throw new Error(`Places search ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { places?: PlaceResult[]; nextPageToken?: string };
    out.push(...(body.places ?? []).map(mapPlace));
    pageToken = body.nextPageToken;
  } while (pageToken && out.length < maxResults);
  return out.slice(0, maxResults);
}

export interface PlaceReview {
  author: string;
  rating: number;
  text: string;
  when: string;
}

/** Reviews for the preview site ("your reviews on it"). Only fetched for leads we actually build a preview for. */
export async function placeReviews(placeId: string): Promise<PlaceReview[]> {
  if (!config.GOOGLE_PLACES_API_KEY) return [];
  const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    headers: { "X-Goog-Api-Key": config.GOOGLE_PLACES_API_KEY, "X-Goog-FieldMask": "reviews" },
  });
  if (!res.ok) throw new Error(`Place details ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as {
    reviews?: {
      rating: number;
      text?: { text: string };
      originalText?: { text: string };
      authorAttribution?: { displayName: string };
      relativePublishTimeDescription?: string;
    }[];
  };
  return (body.reviews ?? [])
    .map((r) => ({
      author: r.authorAttribution?.displayName ?? "Google reviewer",
      rating: r.rating,
      text: (r.originalText?.text ?? r.text?.text ?? "").trim(),
      when: r.relativePublishTimeDescription ?? "",
    }))
    .filter((r) => r.text);
}
