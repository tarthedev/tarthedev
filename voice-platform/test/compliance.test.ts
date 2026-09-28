import { describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import type { Lead } from "../src/db.js";
import { checkAutoDial, type GateInput } from "../src/dialer/compliance.js";

function lead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: 1,
    place_id: null,
    business_name: "Albemarle Roofing",
    category: "Roofing contractor",
    phone: "+12525550199",
    mobile: null,
    email: null,
    contact_name: null,
    address: null,
    city: "Elizabeth City",
    state: "NC",
    website: null,
    rating: 4.8,
    review_count: 40,
    maps_url: null,
    hours_json: null,
    reviews_json: null,
    timezone: "America/New_York",
    source: "places",
    line_type: "landline",
    carrier: null,
    audit_json: null,
    website_status: "none",
    score: 80,
    pitch: "website",
    status: "new",
    consent_json: null,
    preview_slug: null,
    preview_json: null,
    preview_views: 0,
    preview_last_viewed_at: null,
    attempts: 0,
    last_attempt_at: null,
    next_attempt_at: null,
    notes: null,
    is_client: 0,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

// Tuesday Sept 29 2026, 11:00 AM Eastern (EDT = UTC-4)
const TUE_11AM = new Date("2026-09-29T15:00:00Z");
const consent = JSON.stringify({ ai_calls: true, at: "2026-09-29T14:00:00Z" });

function gate(l: Lead, now = TUE_11AM, extra: Partial<GateInput> = {}) {
  return checkAutoDial({ lead: l, now, cfg: config, onDnc: () => false, ...extra });
}

describe("compliance gate", () => {
  it("allows a business landline during cold-call hours", () => {
    expect(gate(lead())).toEqual({ ok: true, basis: "business_landline" });
  });

  it("allows fixed VoIP business lines", () => {
    expect(gate(lead({ line_type: "fixedVoip" })).ok).toBe(true);
  });

  it("sends cell phones without consent to the manual list", () => {
    const r = gate(lead({ line_type: "mobile" }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("needs_consent");
      expect(r.manual).toBe(true);
    }
  });

  it("blocks non-fixed VoIP (often personal) without consent", () => {
    const r = gate(lead({ line_type: "nonFixedVoip" }));
    expect(r.ok).toBe(false);
  });

  it("allows a cell phone when the person gave written consent", () => {
    expect(gate(lead({ line_type: "mobile", consent_json: consent }))).toEqual({ ok: true, basis: "consent" });
  });

  it("treats revoked consent as no consent", () => {
    const revoked = JSON.stringify({ ai_calls: true, revoked_at: "2026-09-29T14:30:00Z" });
    expect(gate(lead({ line_type: "mobile", consent_json: revoked })).ok).toBe(false);
  });

  it("won't cold-call before the line type is known", () => {
    const r = gate(lead({ line_type: null }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("line_type_unknown");
  });

  it("never calls do-not-call numbers, even with consent", () => {
    const r = gate(lead({ consent_json: consent }), TUE_11AM, { onDnc: () => true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("dnc");
    expect(gate(lead({ status: "dnc" })).ok).toBe(false);
  });

  it("stops calling closed leads", () => {
    expect(gate(lead({ status: "won" })).ok).toBe(false);
    expect(gate(lead({ status: "lost" })).ok).toBe(false);
  });

  it("respects the cold-call window (9:30-4:30 by default) in the lead's time zone", () => {
    const early = new Date("2026-09-29T13:00:00Z"); // 9:00 AM ET
    const r = gate(lead(), early);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("hours");
    // Same instant is fine for someone who asked us to call (window starts 8:00).
    expect(gate(lead({ consent_json: consent }), early).ok).toBe(true);
  });

  it("never calls after 9 PM local, whatever the configured window says", () => {
    const late = new Date("2026-09-30T01:30:00Z"); // 9:30 PM ET
    const cfg = { ...config, WEB_LEAD_WINDOW_START: "06:00", WEB_LEAD_WINDOW_END: "23:00" };
    const r = checkAutoDial({ lead: lead({ consent_json: consent }), now: late, cfg, onDnc: () => false });
    expect(r.ok).toBe(false);
    const early = new Date("2026-09-29T11:30:00Z"); // 7:30 AM ET
    expect(checkAutoDial({ lead: lead({ consent_json: consent }), now: early, cfg, onDnc: () => false }).ok).toBe(false);
  });

  it("uses the lead's own time zone", () => {
    // 11:00 AM Eastern is 8:00 AM Pacific: too early for a cold call out west.
    expect(gate(lead({ timezone: "America/Los_Angeles" })).ok).toBe(false);
  });

  it("does not cold-call on weekends", () => {
    const sat = new Date("2026-10-03T15:00:00Z");
    const r = gate(lead(), sat);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("day");
    expect(gate(lead({ consent_json: consent }), sat).ok).toBe(true);
  });

  it("caps attempts and spaces them out", () => {
    expect(gate(lead({ attempts: 3 })).ok).toBe(false);
    const r = gate(lead({ attempts: 1, last_attempt_at: "2026-09-28T15:00:00Z" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("too_soon");
    expect(gate(lead({ attempts: 1, last_attempt_at: "2026-09-26T15:00:00Z" })).ok).toBe(true);
  });

  it("calls at most once a day", () => {
    const r = gate(lead(), TUE_11AM, { callsToday: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("called_today");
  });

  it("waits for a scheduled callback time, then allows it past the attempt cap", () => {
    const future = gate(lead({ status: "callback", next_attempt_at: "2026-09-29T18:00:00Z" }));
    expect(future.ok).toBe(false);
    const due = gate(lead({ status: "callback", attempts: 3, last_attempt_at: "2026-09-29T13:00:00Z", next_attempt_at: "2026-09-29T14:30:00Z" }));
    expect(due.ok).toBe(true);
  });
});
