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
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) jobs.push(sendTelegram(env, alert));
  if (env.NTFY_TOPIC && env.NTFY_SERVER) jobs.push(sendPush(env, alert));
  if (env.RESEND_API_KEY && env.ALERT_EMAIL) jobs.push(sendEmail(env, alert));
  if (!jobs.length) {
    console.warn('no alert channels configured', alert);
    return -1;
  }
  const results = await Promise.allSettled(jobs);
  results.forEach((r) => r.status === 'rejected' && console.error('alert failed:', r.reason));
  return results.filter((r) => r.status === 'fulfilled').length;
}

// Telegram turns the phone number into a tap-to-call link on its own.
async function sendTelegram(env: Env, alert: Alert) {
  const icon = alert.priority === 'urgent' ? '🔥' : alert.priority === 'high' ? '📞' : '📝';
  const text = `${icon} <b>${escape(alert.title)}</b>\n\n${alert.lines.map(escape).join('\n')}`;
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(5000),
    body: JSON.stringify({
      chat_id: env.TELEGRAM_CHAT_ID,
      text,
      parse_mode: 'HTML',
      disable_notification: alert.priority === 'default',
    }),
  });
  if (!res.ok) throw new Error(`telegram ${res.status}: ${await res.text()}`);
}

// ntfy.sh doesn't accept connections from Cloudflare Workers (times out with a 522), so this only
// works with a self-hosted ntfy server set in NTFY_SERVER.
async function sendPush(env: Env, alert: Alert) {
  const res = await fetch(env.NTFY_SERVER!, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(5000),
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
    signal: AbortSignal.timeout(5000),
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
