import type { Env } from './index';

export interface Alert {
  title: string;
  lines: string[];
  phone?: string; // E.164, e.g. +12525550123 — adds Call/Text buttons
  replyTo?: string;
  priority: 'urgent' | 'high' | 'default';
}

const NTFY_PRIORITY = { urgent: 5, high: 4, default: 3 } as const;

// Sends to every channel that is configured. Resolves to the number of channels that succeeded,
// or -1 when none are configured (so local dev without secrets still works).
export async function sendAlert(env: Env, alert: Alert): Promise<number> {
  const jobs: Promise<void>[] = [];
  if (env.NTFY_TOPIC) jobs.push(sendPush(env, alert));
  if (env.RESEND_API_KEY && env.ALERT_EMAIL) jobs.push(sendEmail(env, alert));
  if (!jobs.length) {
    console.warn('no alert channels configured', alert);
    return -1;
  }
  const results = await Promise.allSettled(jobs);
  results.forEach((r) => r.status === 'rejected' && console.error('alert failed:', r.reason));
  return results.filter((r) => r.status === 'fulfilled').length;
}

async function sendPush(env: Env, alert: Alert) {
  const res = await fetch(env.NTFY_SERVER || 'https://ntfy.sh', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      topic: env.NTFY_TOPIC,
      title: alert.title,
      message: alert.lines.join('\n'),
      priority: NTFY_PRIORITY[alert.priority],
      tags: alert.priority === 'urgent' ? ['fire'] : ['telephone_receiver'],
      ...(alert.phone && {
        click: `tel:${alert.phone}`,
        actions: [
          { action: 'view', label: 'Call', url: `tel:${alert.phone}` },
          { action: 'view', label: 'Text', url: `sms:${alert.phone}` },
        ],
      }),
    }),
  });
  if (!res.ok) throw new Error(`ntfy ${res.status}: ${await res.text()}`);
}

async function sendEmail(env: Env, alert: Alert) {
  const callLink = alert.phone
    ? `<p style="font-size:20px"><a href="tel:${alert.phone}">Call ${escape(formatPhone(alert.phone))}</a></p>`
    : '';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: env.ALERT_FROM || 'Rollinson Network <leads@rollinsonnetwork.com>',
      to: [env.ALERT_EMAIL],
      subject: alert.title,
      ...(alert.replyTo && { reply_to: alert.replyTo }),
      text: alert.lines.join('\n'),
      html: `${callLink}<p>${alert.lines.map(escape).join('<br>')}</p>`,
    }),
  });
  if (!res.ok) throw new Error(`resend ${res.status}: ${await res.text()}`);
}

export function formatPhone(e164: string): string {
  const d = e164.replace(/^\+1/, '');
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : e164;
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
