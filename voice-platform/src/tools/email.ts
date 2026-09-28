import { config } from "../config.js";

/** Send an email through Resend (the same provider the website's contact form already uses). */
export async function sendEmail(opts: { to: string | string[]; subject: string; html: string; replyTo?: string }) {
  if (!config.RESEND_API_KEY) throw new Error("Email is not configured (RESEND_API_KEY)");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: config.EMAIL_FROM,
      to: Array.isArray(opts.to) ? opts.to : [opts.to],
      subject: opts.subject,
      html: opts.html,
      reply_to: opts.replyTo,
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  return ((await res.json()) as { id: string }).id;
}
