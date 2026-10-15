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
  const record = { at: new Date().toISOString(), grade, score, ...f, phone };
  delete (record as Record<string, unknown>).company_site;
  delete (record as Record<string, unknown>).started_at;
  console.log('lead', JSON.stringify(record));
  // Keys sort newest-first so /admin/leads can list without loading everything.
  const key = `lead:${String(9e15 - Date.now()).padStart(16, '0')}:${crypto.randomUUID().slice(0, 8)}`;
  const saved = await env.LEADS.put(key, JSON.stringify(record)).then(
    () => true,
    (err) => (console.error('lead save failed:', err), false),
  );

  const delivered = await sendAlert(env, {
    title: `${grade} lead: ${f.business} — ${formatPhone(phone)}`,
    lines,
    phone,
    replyTo: f.email || undefined,
    priority: grade === 'HOT' ? 'urgent' : grade === 'WARM' ? 'high' : 'default',
  });
  // Only tell the visitor to call instead if the lead was neither saved nor alerted.
  if (!saved && delivered <= 0) return reply(false, 502, 'could not deliver');
  return reply(true);
}

// Private list of saved leads: https://rollinsonnetwork.com/admin/leads?key=ADMIN_TOKEN
export async function listLeads(env: Env): Promise<Response> {
  const { keys } = await env.LEADS.list({ prefix: 'lead:', limit: 200 });
  const leads = (await Promise.all(keys.map((k) => env.LEADS.get(k.name, 'json')))) as Record<string, string>[];
  const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const rows = leads
    .filter(Boolean)
    .map(
      (l) => `<tr class="${esc(l.grade).toLowerCase()}">
        <td>${esc(new Date(l.at).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'short', timeStyle: 'short' }))}</td>
        <td><b>${esc(l.grade)}</b> ${esc(l.score)}</td>
        <td>${esc(l.name)}<br><small>${esc(l.business)}</small></td>
        <td><a href="tel:${esc(l.phone)}">${esc(formatPhone(l.phone))}</a><br><small>${esc(l.best_time)}</small></td>
        <td><small>${esc(l.trade)} · ${esc(SITE_LABEL[l.has_site] ?? '')} · ${esc(l.area)} · ${esc(TIMELINE_LABEL[l.timeline] ?? '')} · ${esc(BUDGET_LABEL[l.budget] ?? '')}${l.email ? ` · ${esc(l.email)}` : ''}</small></td>
      </tr>`,
    )
    .join('');
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Leads — Rollinson Network</title>
<style>body{font:15px system-ui,sans-serif;margin:16px;color:#241E1A}table{border-collapse:collapse;width:100%}
td{padding:9px 8px;border-bottom:1px solid #DDD9D2;vertical-align:top}small{color:#6B635C}a{color:#14684B;font-weight:600}
tr.hot td:first-child{border-left:4px solid #B9444A}tr.warm td:first-child{border-left:4px solid #C99A2E}tr.cold td:first-child{border-left:4px solid #DDD9D2}</style>
<h1 style="font-size:20px">Leads (${leads.length})</h1><table>${rows || '<tr><td>No leads yet.</td></tr>'}</table>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
