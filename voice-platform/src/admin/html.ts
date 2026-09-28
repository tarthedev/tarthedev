import { config, readiness } from "../config.js";
import { escapeHtml } from "../lib/util.js";

export const h = (v: unknown) => escapeHtml(v === null || v === undefined ? "" : String(v));

export function when(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", {
    timeZone: config.TIMEZONE,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function layout(title: string, body: string, flash?: string): string {
  const nav = [
    ["/admin", "Dashboard"],
    ["/admin/leads", "Leads"],
    ["/admin/manual", "Call yourself"],
    ["/admin/calls", "Calls"],
    ["/admin/tenants", "Receptionist clients"],
  ]
    .map(([href, label]) => `<a href="${href}">${label}</a>`)
    .join("");
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${h(title)} · ${h(config.BUSINESS_NAME)}</title>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{--ink:#241E1A;--muted:#6B635C;--rule:#DDD9D2;--paper:#fff;--green:#14684B;--green-dk:#0D4D38;--wash:#F1EFEB;--red:#B9444A;--amber:#A67C00}
*{box-sizing:border-box}body{margin:0;font-family:'Instrument Sans',system-ui,sans-serif;color:var(--ink);background:var(--paper);font-size:15px;line-height:1.5}
a{color:var(--green)}.top{border-bottom:2px solid var(--ink);padding:14px 0;margin-bottom:24px}
.wrap{max-width:1120px;margin:0 auto;padding:0 18px}.top .wrap{display:flex;gap:18px;align-items:center;flex-wrap:wrap}
.top b{font-size:16px;margin-right:10px}.top a{text-decoration:none;font-weight:600;color:var(--ink)}.top a:hover{color:var(--green)}
h1{font-size:26px;letter-spacing:-.02em;margin:0 0 16px}h2{font-size:16px;margin:28px 0 10px}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:8px 8px;border-bottom:1px solid var(--rule);vertical-align:top}
th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
.card{border:1px solid var(--rule);border-radius:8px;padding:16px;margin-bottom:14px;background:#fff}
.grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}
.stat b{display:block;font-size:28px;letter-spacing:-.03em}.stat span{color:var(--muted);font-size:13px}
.pill{display:inline-block;padding:2px 8px;border-radius:99px;font-size:12px;font-weight:600;background:var(--wash)}
.pill.ok{background:#E3F1EA;color:var(--green-dk)}.pill.no{background:#F7E4E5;color:var(--red)}.pill.warn{background:#FFF1C9;color:#7A5B00}
input,select,textarea{font:inherit;padding:8px 10px;border:1px solid var(--rule);border-radius:6px;width:100%;background:#fff}
textarea{min-height:110px}label{display:block;font-weight:600;font-size:13px;margin:10px 0 4px}
button,.btn{font:inherit;font-weight:700;background:var(--green);color:#fff;border:0;border-bottom:3px solid var(--green-dk);padding:9px 14px;border-radius:6px;cursor:pointer;text-decoration:none;display:inline-block}
button.alt,.btn.alt{background:#fff;color:var(--ink);border:1.5px solid var(--ink);border-bottom-width:3px}
button.danger{background:var(--red);border-bottom-color:#8b2f34}
form.inline{display:inline}.row{display:flex;gap:10px;flex-wrap:wrap;align-items:end}.row>*{flex:1 1 180px}
.muted{color:var(--muted)}.flash{background:#E3F1EA;border-left:4px solid var(--green);padding:10px 14px;margin-bottom:16px;border-radius:4px}
pre,.transcript{white-space:pre-wrap;font-size:13.5px;background:var(--wash);padding:12px;border-radius:6px;max-height:520px;overflow:auto}
.transcript .caller{color:var(--green-dk)}.transcript .system{color:var(--muted);font-size:12px}
</style></head><body>
<div class="top"><div class="wrap"><b>${h(config.BUSINESS_NAME)} AI</b>${nav}</div></div>
<div class="wrap">${flash ? `<div class="flash">${h(flash)}</div>` : ""}${body}</div><div style="height:60px"></div></body></html>`;
}

export function readinessCard(): string {
  const r = readiness();
  const labels: Record<keyof typeof r, string> = {
    claude: "Claude API key",
    twilio: "Twilio account",
    salesLine: "Sales phone number",
    demoLine: "Receptionist demo line",
    sms: "Texting",
    email: "Email (Resend)",
    stripe: "Stripe payment links",
    calcom: "Cal.com booking",
    places: "Google Places (lead finding)",
    admin: "Admin password",
  };
  return `<div class="card"><b>Setup</b><div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px">${(Object.keys(r) as (keyof typeof r)[])
    .map((k) => `<span class="pill ${r[k] ? "ok" : "no"}">${r[k] ? "✓" : "✗"} ${labels[k]}</span>`)
    .join("")}</div></div>`;
}

export function statusPill(status: string): string {
  const cls = status === "won" || status === "interested" ? "ok" : status === "dnc" || status === "lost" ? "no" : status === "callback" ? "warn" : "";
  return `<span class="pill ${cls}">${h(status)}</span>`;
}
