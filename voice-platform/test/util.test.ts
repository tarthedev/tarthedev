import { describe, expect, it } from "vitest";
import { historyContent } from "../src/llm.js";
import { formatPhone, speakablePhone } from "../src/offer.js";
import { scoreLead } from "../src/leads/score.js";
import { estimateSpeechMs, localTime, makeToken, readToken, toE164, zonedToUtc } from "../src/lib/util.js";

describe("phone numbers", () => {
  it("normalizes US numbers to E.164", () => {
    expect(toE164("(252) 250-3044")).toBe("+12522503044");
    expect(toE164("1-252-250-3044")).toBe("+12522503044");
    expect(toE164("+1 252 250 3044")).toBe("+12522503044");
    expect(toE164("252.250.3044")).toBe("+12522503044");
  });
  it("rejects junk", () => {
    expect(toE164("555-1234")).toBeNull();
    expect(toE164("(052) 250-3044")).toBeNull();
    expect(toE164("")).toBeNull();
    expect(toE164(null)).toBeNull();
  });
  it("formats for display and for speech", () => {
    expect(formatPhone("+12522503044")).toBe("(252) 250-3044");
    expect(speakablePhone("+12522503044")).toBe("2 5 2, 2 5 0, 3 0 4 4");
  });
});

describe("signed tokens", () => {
  it("round-trips", () => {
    const t = makeToken({ cs: "CA123", m: "sales" });
    expect(readToken(t)).toMatchObject({ cs: "CA123", m: "sales" });
  });
  it("rejects tampering and expiry", () => {
    const t = makeToken({ cs: "CA123" });
    const [body, mac] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ cs: "CA999", exp: 9999999999 })).toString("base64url");
    expect(readToken(`${forged}.${mac}`)).toBeNull();
    expect(readToken(`${body}.x${mac.slice(1)}`)).toBeNull();
    expect(readToken(makeToken({ cs: "x" }, -10))).toBeNull();
    expect(readToken("garbage")).toBeNull();
  });
});

describe("time zones", () => {
  it("reads local time", () => {
    const t = localTime(new Date("2026-09-29T15:00:00Z"), "America/New_York");
    expect(t).toEqual({ weekday: 2, minutes: 11 * 60, dateKey: "2026-09-29" });
  });
  it("converts local wall time to UTC across DST", () => {
    expect(zonedToUtc("2026-09-29T14:30", "America/New_York")?.toISOString()).toBe("2026-09-29T18:30:00.000Z");
    expect(zonedToUtc("2026-12-01T09:00", "America/New_York")?.toISOString()).toBe("2026-12-01T14:00:00.000Z");
    expect(zonedToUtc("nonsense", "America/New_York")).toBeNull();
  });
  it("estimates speaking time", () => {
    expect(estimateSpeechMs("hi")).toBe(1200);
    expect(estimateSpeechMs("one two three four five six seven eight nine ten eleven twelve thirteen")).toBeGreaterThan(5000);
  });
});

describe("lead scoring", () => {
  it("ranks businesses with no website highest and pitches the site", () => {
    const r = scoreLead({ website_status: "none", review_count: 60, rating: 4.7, category: "Roofing contractor", line_type: "landline" });
    expect(r.score).toBeGreaterThanOrEqual(80);
    expect(r.pitch).toBe("both");
  });
  it("pitches the receptionist to busy trades that already have a good site", () => {
    const r = scoreLead({ website_status: "ok", review_count: 20, rating: 4.9, category: "Plumber", line_type: "landline" });
    expect(r.pitch).toBe("receptionist");
  });
  it("scores a healthy non-trade site low", () => {
    const r = scoreLead({ website_status: "ok", review_count: 3, rating: 3.5, category: "Gift shop", line_type: "mobile" });
    expect(r.score).toBeLessThan(20);
  });
});

describe("history content after a model fallback", () => {
  it("drops non-text blocks before the last fallback marker and the marker itself", () => {
    const content = [
      { type: "thinking", thinking: "", signature: "s1" },
      { type: "text", text: "Sure, " },
      { type: "fallback", from: { model: "a" }, to: { model: "b" } },
      { type: "thinking", thinking: "", signature: "s2" },
      { type: "text", text: "here you go." },
    ] as never;
    const out = historyContent(content) as { type: string }[];
    expect(out.map((b) => b.type)).toEqual(["text", "thinking", "text"]);
  });
  it("passes normal content through unchanged", () => {
    const content = [
      { type: "thinking", thinking: "", signature: "s" },
      { type: "text", text: "Hi" },
      { type: "tool_use", id: "t1", name: "x", input: {} },
    ] as never;
    expect(historyContent(content)).toEqual(content);
  });
});
