import { config } from "../config.js";
import { escapeHtml } from "../lib/util.js";
import { sendEmail } from "./email.js";
import { sendSms } from "./twilio.js";

/**
 * Tell a business owner (Aaron, or a receptionist client) that something happened.
 * Tries text and email; a failure in one never blocks the other or the call.
 */
export async function notifyOwner(opts: {
  cell?: string | null;
  email?: string | null;
  sms?: string;
  subject?: string;
  body?: string;
  smsFrom?: string | null;
}): Promise<void> {
  const tasks: Promise<unknown>[] = [];
  if (opts.cell && opts.sms && config.TWILIO_ACCOUNT_SID) {
    tasks.push(sendSms(opts.cell, opts.sms.slice(0, 1500), opts.smsFrom ?? undefined));
  }
  if (opts.email && opts.subject && config.RESEND_API_KEY) {
    const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;white-space:pre-wrap">${escapeHtml(
      opts.body ?? opts.sms ?? "",
    )}</div>`;
    tasks.push(sendEmail({ to: opts.email, subject: opts.subject, html }));
  }
  const results = await Promise.allSettled(tasks);
  for (const r of results) if (r.status === "rejected") console.error("[notify] failed:", r.reason);
}

/** Shortcut for alerts to Aaron. */
export function notifyAaron(sms: string, subject?: string, body?: string) {
  return notifyOwner({
    cell: config.OWNER_CELL,
    email: config.OWNER_EMAIL,
    sms,
    subject: subject ?? sms.slice(0, 80),
    body: body ?? sms,
  });
}
