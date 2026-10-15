import type { Env } from './index';
import { formatPhone, sendAlert } from './alerts';

const SERVICE_AREA = ['Pasquotank', 'Camden', 'Currituck', 'Perquimans'];
const SITE_LABEL: Record<string, string> = {
  none: 'No website',
  facebook: 'Facebook page only',
  outdated: 'Old site / not bringing calls',
  fine: 'Has a site that works',
};
const TIMELINE_LABEL: Record<string, string> = { asap: 'ASAP', month: 'Next month or so', later: 'Just looking' };
const BUDGET_LABEL: Record<string, string> = { yes: 'OK with $756 + $127/mo', talk: 'Wants to talk price', no: 'Price too high' };

// Hot = call today. Budget and timeline carry the most weight.
export function scoreLead(f: Record<string, string>): { score: number; grade: 'HOT' | 'WARM' | 'COLD' } {
  let score = 0;
  score += { yes: 3, talk: 1, no: -2 }[f.budget] ?? 0;
  score += { asap: 3, month: 2, later: 0 }[f.timeline] ?? 0;
  score += { none: 2, facebook: 2, outdated: 1, fine: 0 }[f.has_site] ?? 0;
  if (SERVICE_AREA.includes(f.area)) score += 1;
  return { score, grade: score >= 7 ? 'HOT' : score >= 4 ? 'WARM' : 'COLD' };
}

export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(digits) ? `+1${digits}` : null;
}

export async function handleLead(request: Request, env: Env): Promise<Response> {
  const fromScript = request.headers.get('x-requested-with') === 'fetch';
  const reply = (ok: boolean, status = 200, error?: string) =>
    fromScript ? Response.json(ok ? { ok } : { ok, error }, { status }) : Response.redirect(new URL(ok ? '/thanks?lead=1' : '/#start', request.url).toString(), 303);

  const form = await request.formData();
  const f: Record<string, string> = {};
  for (const [k, v] of form) if (typeof v === 'string') f[k] = v.trim().slice(0, 200);

  // Bots fill the hidden field or submit instantly; pretend it worked so they move on.
  const elapsed = Date.now() - Number(f.started_at || 0);
  if (f.company_site || (f.started_at && elapsed < 3000)) return reply(true);

  const phone = normalizePhone(f.phone ?? '');
  if (!f.name || !f.business || !phone) return reply(false, 400, 'name, business and a valid US phone are required');

  const { score, grade } = scoreLead(f);
  const lines = [
    `${f.name} — ${f.business}`,
    `Phone: ${formatPhone(phone)}  (best time: ${f.best_time || 'Anytime'})`,
    ...(f.email ? [`Email: ${f.email}`] : []),
    `Business: ${f.trade || '—'}`,
    `Website now: ${SITE_LABEL[f.has_site] ?? '—'}`,
    `Area: ${f.area || '—'}`,
    `Timeline: ${TIMELINE_LABEL[f.timeline] ?? '—'}`,
    `Budget: ${BUDGET_LABEL[f.budget] ?? '—'}`,
    `Score: ${score} (${grade})`,
  ];
  console.log('lead', JSON.stringify({ grade, score, ...f, phone }));

  const delivered = await sendAlert(env, {
    title: `${grade} lead: ${f.business} — ${formatPhone(phone)}`,
    lines,
    phone,
    replyTo: f.email || undefined,
    priority: grade === 'HOT' ? 'urgent' : grade === 'WARM' ? 'high' : 'default',
  });
  // Every configured channel failed: tell the visitor so they call instead of waiting.
  if (delivered === 0) return reply(false, 502, 'could not deliver');
  return reply(true);
}
