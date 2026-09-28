// Cal.com API v2: look up open slots and create bookings.
// https://cal.com/docs/api-reference/v2

const BASE = "https://api.cal.com/v2";
const SLOTS_VERSION = "2024-09-04";
const BOOKINGS_VERSION = "2026-02-25";

export interface CalAccount {
  apiKey: string;
  eventTypeId: number;
}

export interface Slot {
  start: string; // ISO with offset
}

export async function getSlots(acct: CalAccount, fromIso: string, toIso: string, timeZone: string): Promise<Slot[]> {
  const url = new URL(`${BASE}/slots`);
  url.searchParams.set("eventTypeId", String(acct.eventTypeId));
  url.searchParams.set("start", fromIso);
  url.searchParams.set("end", toIso);
  url.searchParams.set("timeZone", timeZone);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${acct.apiKey}`, "cal-api-version": SLOTS_VERSION },
  });
  if (!res.ok) throw new Error(`Cal.com slots ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { data?: Record<string, Slot[]> };
  return Object.values(body.data ?? {}).flat();
}

export async function createBooking(
  acct: CalAccount,
  b: { start: string; name: string; email: string; timeZone: string; phone?: string; notes?: string },
): Promise<{ uid: string; start: string }> {
  const res = await fetch(`${BASE}/bookings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${acct.apiKey}`,
      "cal-api-version": BOOKINGS_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      start: new Date(b.start).toISOString(),
      eventTypeId: acct.eventTypeId,
      attendee: { name: b.name, email: b.email, timeZone: b.timeZone, phoneNumber: b.phone },
      metadata: b.notes ? { notes: b.notes.slice(0, 500) } : undefined,
    }),
  });
  if (!res.ok) throw new Error(`Cal.com booking ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { data: { uid: string; start: string } };
  return { uid: body.data.uid, start: body.data.start };
}

/** Group slots into something short enough to read out loud: at most `perDay` times on `days` days. */
export function summarizeSlots(slots: Slot[], timeZone: string, days = 3, perDay = 4): string {
  const byDay = new Map<string, string[]>();
  for (const s of slots) {
    const d = new Date(s.start);
    const day = d.toLocaleDateString("en-US", { timeZone, weekday: "long", month: "long", day: "numeric" });
    const time = d.toLocaleTimeString("en-US", { timeZone, hour: "numeric", minute: "2-digit" });
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(`${time} (${s.start})`);
  }
  const lines = [...byDay.entries()].slice(0, days).map(([day, times]) => `${day}: ${times.slice(0, perDay).join(", ")}`);
  return lines.length ? lines.join("\n") : "No open times in that range.";
}
