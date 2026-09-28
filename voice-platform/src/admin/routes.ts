import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";
import {
  addDnc,
  appendLeadNote,
  getCall,
  getDb,
  getLead,
  getTenant,
  listCalls,
  listEvents,
  listLeads,
  listTenants,
  saveTenant,
  setSetting,
  tenantMinutesThisMonth,
  updateLead,
  type Lead,
  type Tenant,
} from "../db.js";
import { dialerRunning, dialQueue, gateFor, manualQueue, placeSalesCall } from "../dialer/dialer.js";
import { enrichLead, findLeads, importCsv } from "../leads/pipeline.js";
import { safeEqual, slugify, toE164 } from "../lib/util.js";
import { formatPhone, offer } from "../offer.js";
import { buildPreview, previewUrl } from "../preview/generate.js";
import { activeCalls } from "../relay/calls.js";
import type { TranscriptLine } from "../relay/types.js";
import { buyNumber, configureExistingNumber, searchLocalNumbers } from "../tools/twilio.js";
import { h, layout, readinessCard, statusPill, when } from "./html.js";

type Form = Record<string, string>;

function page(reply: FastifyReply, title: string, body: string, req?: FastifyRequest) {
  const flash = (req?.query as Form | undefined)?.flash;
  return reply.type("text/html").header("Cache-Control", "no-store").send(layout(title, body, flash));
}

const back = (reply: FastifyReply, path: string, flash: string) =>
  reply.redirect(`${path}${path.includes("?") ? "&" : "?"}flash=${encodeURIComponent(flash)}`);

export async function adminRoutes(app: FastifyInstance) {
  // Basic auth over HTTPS, plus a same-origin check on every form post.
  app.addHook("onRequest", async (req, reply) => {
    if (!config.ADMIN_PASSWORD) return reply.code(503).send("Set ADMIN_PASSWORD in .env to use the dashboard.");
    const [scheme, encoded] = (req.headers.authorization ?? "").split(" ");
    const [user, ...rest] = scheme === "Basic" && encoded ? Buffer.from(encoded, "base64").toString().split(":") : [];
    const pass = rest.join(":");
    if (!user || !safeEqual(user, config.ADMIN_USER) || !safeEqual(pass, config.ADMIN_PASSWORD)) {
      return reply.code(401).header("WWW-Authenticate", 'Basic realm="Rollinson AI"').send("Login required");
    }
    if (req.method === "POST") {
      const origin = (req.headers.origin as string | undefined) ?? (req.headers.referer as string | undefined) ?? "";
      if (!origin.startsWith(new URL(config.PUBLIC_BASE_URL).origin)) return reply.code(403).send("Cross-site form post blocked");
    }
  });

  // ---------- dashboard ----------
  app.get("/admin", async (req, reply) => {
    const d = getDb();
    const counts = Object.fromEntries(
      (d.prepare("SELECT status, COUNT(*) n FROM leads GROUP BY status").all() as { status: string; n: number }[]).map((r) => [r.status, r.n]),
    );
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const callsToday = d.prepare("SELECT COUNT(*) n FROM calls WHERE started_at >= ?").get(today.toISOString()) as { n: number };
    const hot = listEvents({ limit: 400 })
      .filter((e) => ["preview_viewed", "payment_link_sent", "payment", "web_lead", "demo_line_call", "live_demo_started"].includes(e.type))
      .slice(0, 15);
    const live = activeCalls().filter((c) => !c.finalized);
    const queue = dialQueue(400);
    const ready = queue.filter((q) => q.gate.ok).length;
    const running = dialerRunning();
    const body = `
<h1>Dashboard</h1>
${readinessCard()}
<div class="grid">
  <div class="card stat"><b>${counts.new ?? 0}</b><span>new leads</span></div>
  <div class="card stat"><b>${counts.interested ?? 0}</b><span>interested</span></div>
  <div class="card stat"><b>${counts.callback ?? 0}</b><span>callbacks</span></div>
  <div class="card stat"><b>${counts.won ?? 0}</b><span>won</span></div>
  <div class="card stat"><b>${callsToday.n}</b><span>calls today</span></div>
</div>
<div class="card">
  <b>AI dialer:</b> ${
    !config.DIALER_ENABLED
      ? `<span class="pill no">off</span> <span class="muted">Set DIALER_ENABLED=true in .env to let the AI place calls on its own.</span>`
      : running
        ? `<span class="pill ok">running</span>`
        : `<span class="pill warn">paused</span>`
  }
  <span class="muted"> · ${ready} lead(s) callable right now · max ${config.MAX_CONCURRENT_CALLS} at a time, ${config.DAILY_CALL_CAP}/day · cold-call hours ${config.CALL_WINDOW_START}–${config.CALL_WINDOW_END}</span>
  ${
    config.DIALER_ENABLED
      ? `<form class="inline" method="post" action="/admin/dialer"><input type="hidden" name="action" value="${running ? "pause" : "resume"}"><button class="${running ? "alt" : ""}" style="margin-left:10px">${running ? "Pause" : "Resume"}</button></form>`
      : ""
  }
</div>
${live.length ? `<h2>On the phone right now</h2><div class="card">${live.map((c) => `<div>${h(c.kind)} · ${h(formatPhone(c.direction === "inbound" ? c.from : c.to))} · ${Math.round((Date.now() - c.startedAt) / 1000)}s <a href="/admin/calls/${h(c.callSid)}">transcript</a></div>`).join("")}</div>` : ""}
<h2>Hot activity</h2>
<table><tr><th>When</th><th>What</th><th>Lead</th></tr>
${hot
  .map((e) => {
    const lead = e.lead_id ? getLead(e.lead_id) : undefined;
    return `<tr><td>${when(e.created_at)}</td><td>${h(e.type.replace(/_/g, " "))}</td><td>${lead ? `<a href="/admin/leads/${lead.id}">${h(lead.business_name)}</a>` : ""}</td></tr>`;
  })
  .join("")}</table>
<h2>Phone number setup</h2>
<div class="card"><p class="muted">Points your sales line and demo line at this server (voice + text webhooks). Run once after buying the numbers, and again if your domain changes.</p>
<form method="post" action="/admin/setup/numbers"><button class="alt">Configure Twilio numbers</button></form></div>`;
    return page(reply, "Dashboard", body, req);
  });

  app.post("/admin/dialer", async (req, reply) => {
    const action = (req.body as Form).action;
    setSetting("dialer_paused", action === "pause" ? "1" : "0");
    return back(reply, "/admin", action === "pause" ? "Dialer paused" : "Dialer running");
  });

  app.post("/admin/setup/numbers", async (_req, reply) => {
    const done: string[] = [];
    for (const n of [config.SALES_CALLER_ID, config.DEMO_LINE_NUMBER].filter(Boolean)) {
      try {
        await configureExistingNumber(n);
        done.push(`${formatPhone(n)} ✓`);
      } catch (e) {
        done.push(`${formatPhone(n)}: ${(e as Error).message}`);
      }
    }
    return back(reply, "/admin", done.join(" · ") || "No numbers configured in .env");
  });

  // ---------- leads ----------
  app.get("/admin/leads", async (req, reply) => {
    const q = req.query as Form;
    const leads = listLeads({ status: q.status || undefined, q: q.q || undefined, limit: 300 });
    const statuses = ["", "new", "contacted", "callback", "interested", "won", "lost", "dnc"];
    const body = `
<h1>Leads</h1>
<div class="grid">
  <form class="card" method="post" action="/admin/leads/find">
    <b>Find businesses on Google</b>
    <label>Search</label><input name="query" required placeholder="e.g. roofing contractor in Elizabeth City, NC">
    <label>How many (max 60)</label><input name="max" type="number" value="40" min="1" max="60">
    <p class="muted" style="font-size:13px">Checks each website, looks up whether the number is a landline or cell, and scores the lead. Takes about a minute.</p>
    <button>Find leads</button>
  </form>
  <form class="card" method="post" action="/admin/leads/import">
    <b>Import a CSV</b>
    <label>Paste CSV (needs name + phone columns; website, category, city optional)</label>
    <textarea name="csv" required></textarea>
    <button style="margin-top:10px">Import</button>
  </form>
</div>
<form class="row" method="get" style="margin:10px 0 14px">
  <div><label>Status</label><select name="status">${statuses.map((s) => `<option value="${s}" ${q.status === s ? "selected" : ""}>${s || "all"}</option>`).join("")}</select></div>
  <div><label>Search</label><input name="q" value="${h(q.q ?? "")}"></div>
  <div style="flex:0 0 auto"><button class="alt">Filter</button></div>
</form>
<table><tr><th>Score</th><th>Business</th><th>Website</th><th>Line</th><th>Pitch</th><th>Status</th><th>Tries</th><th>AI can call?</th></tr>
${leads
  .map((l) => {
    const g = gateFor(l);
    return `<tr><td><b>${l.score}</b></td><td><a href="/admin/leads/${l.id}">${h(l.business_name)}</a><div class="muted">${h(l.category ?? "")} · ${h(l.city ?? "")}</div></td>
<td>${h(l.website_status ?? "")}</td><td>${h(l.line_type ?? "?")}</td><td>${h(l.pitch ?? "")}</td><td>${statusPill(l.status)}</td><td>${l.attempts}</td>
<td>${g.ok ? '<span class="pill ok">now</span>' : `<span class="muted" style="font-size:12.5px">${h(g.reason)}</span>`}</td></tr>`;
  })
  .join("")}
</table>`;
    return page(reply, "Leads", body, req);
  });

  app.post("/admin/leads/find", async (req, reply) => {
    const f = req.body as Form;
    try {
      const r = await findLeads(f.query, Math.min(Number(f.max) || 40, 60));
      return back(reply, "/admin/leads", `Found ${r.found}, added ${r.added} new (skipped ${r.skippedClosed} closed, ${r.skippedNoPhone} with no phone).`);
    } catch (e) {
      return back(reply, "/admin/leads", `Search failed: ${(e as Error).message}`);
    }
  });

  app.post("/admin/leads/import", async (req, reply) => {
    try {
      const r = await importCsv((req.body as Form).csv ?? "");
      return back(reply, "/admin/leads", `Imported: ${r.added} new, ${r.updated} updated, ${r.skipped} skipped (no name or phone).`);
    } catch (e) {
      return back(reply, "/admin/leads", `Import failed: ${(e as Error).message}`);
    }
  });

  app.get("/admin/leads/:id", async (req, reply) => {
    const lead = getLead(Number((req.params as Form).id));
    if (!lead) return reply.code(404).send("Not found");
    const g = gateFor(lead);
    const audit = lead.audit_json ? (JSON.parse(lead.audit_json) as { issues?: string[]; loadMs?: number }) : null;
    const calls = listCalls({ leadId: lead.id });
    const events = listEvents({ leadId: lead.id, limit: 40 });
    const body = `
<h1>${h(lead.business_name)} ${statusPill(lead.status)}</h1>
<div class="grid">
  <div class="card">
    <div><b>Phone:</b> ${lead.phone ? `<a href="tel:${h(lead.phone)}">${h(formatPhone(lead.phone))}</a>` : "none"} <span class="pill">${h(lead.line_type ?? "line type unknown")}</span></div>
    ${lead.mobile ? `<div><b>Cell (from call):</b> ${h(formatPhone(lead.mobile))}</div>` : ""}
    ${lead.contact_name ? `<div><b>Contact:</b> ${h(lead.contact_name)}</div>` : ""}
    ${lead.email ? `<div><b>Email:</b> ${h(lead.email)}</div>` : ""}
    <div><b>Category:</b> ${h(lead.category ?? "")}</div>
    <div><b>Address:</b> ${h(lead.address ?? "")}</div>
    <div><b>Google:</b> ${lead.rating ?? "–"}★ (${lead.review_count ?? 0}) ${lead.maps_url ? `<a href="${h(lead.maps_url)}" target="_blank">listing</a>` : ""}</div>
    <div><b>Website:</b> ${lead.website ? `<a href="${h(lead.website)}" target="_blank">${h(lead.website)}</a>` : "none"} (${h(lead.website_status ?? "not checked")})</div>
    ${audit?.issues?.length ? `<ul>${audit.issues.map((i) => `<li>${h(i)}</li>`).join("")}</ul>` : ""}
    <div><b>Score:</b> ${lead.score} · <b>Pitch:</b> ${h(lead.pitch ?? "")} · <b>Source:</b> ${h(lead.source)}${lead.consent_json ? ' · <span class="pill ok">consented to AI calls</span>' : ""}</div>
  </div>
  <div class="card">
    <b>AI call</b>
    <p>${g.ok ? `<span class="pill ok">Allowed now (${g.basis === "consent" ? "they gave written consent" : "business landline"})</span>` : `<span class="pill ${g.manual ? "warn" : "no"}">${h(g.reason)}</span>`}</p>
    <form method="post" action="/admin/leads/${lead.id}/call"><button ${g.ok ? "" : "disabled"}>Have the AI call now</button></form>
    <p style="margin-top:14px"><b>Preview site:</b> ${lead.preview_slug ? `<a href="${h(previewUrl(lead))}" target="_blank">${h(previewUrl(lead))}</a> · opened ${lead.preview_views}×${lead.preview_last_viewed_at ? `, last ${when(lead.preview_last_viewed_at)}` : ""}` : "not built yet"}</p>
    <form method="post" action="/admin/leads/${lead.id}/preview"><button class="alt">${lead.preview_slug ? "Rebuild preview" : "Build preview"}</button></form>
    <form method="post" action="/admin/leads/${lead.id}/enrich" style="margin-top:8px"><button class="alt">Re-check website & line type</button></form>
  </div>
</div>
<form class="card" method="post" action="/admin/leads/${lead.id}/update">
  <div class="row">
    <div><label>Status</label><select name="status">${["new", "contacted", "callback", "interested", "won", "lost"].map((s) => `<option ${lead.status === s ? "selected" : ""}>${s}</option>`).join("")}</select></div>
    <div><label>Pitch</label><select name="pitch">${["website", "receptionist", "both"].map((s) => `<option ${lead.pitch === s ? "selected" : ""}>${s}</option>`).join("")}</select></div>
    <div><label>Contact name</label><input name="contact_name" value="${h(lead.contact_name ?? "")}"></div>
    <div><label>Cell</label><input name="mobile" value="${h(lead.mobile ?? "")}"></div>
    <div><label>Existing website client?</label><select name="is_client"><option value="0">no</option><option value="1" ${lead.is_client ? "selected" : ""}>yes</option></select></div>
  </div>
  <label>Add a note</label><input name="note">
  <div style="margin-top:10px"><button>Save</button></div>
</form>
<form method="post" action="/admin/leads/${lead.id}/dnc" onsubmit="return confirm('Never call this number again?')"><button class="danger">Do not call</button></form>
<h2>Notes</h2><pre>${h(lead.notes ?? "")}</pre>
<h2>Calls</h2>
<table><tr><th>When</th><th>Type</th><th>Status</th><th>Outcome</th><th>Summary</th></tr>
${calls.map((c) => `<tr><td><a href="/admin/calls/${h(c.call_sid)}">${when(c.started_at)}</a></td><td>${h(c.kind)} ${h(c.direction)}</td><td>${h(c.status ?? "")} ${h(c.answered_by ?? "")}</td><td>${h(c.outcome ?? "")}</td><td>${h(c.summary ?? "")}</td></tr>`).join("")}
</table>
<h2>Activity</h2>
<table>${events.map((e) => `<tr><td>${when(e.created_at)}</td><td>${h(e.type)}</td><td class="muted" style="font-size:12.5px">${h((e.data_json ?? "").slice(0, 200))}</td></tr>`).join("")}</table>`;
    return page(reply, lead.business_name, body, req);
  });

  app.post("/admin/leads/:id/call", async (req, reply) => {
    const id = Number((req.params as Form).id);
    try {
      const r = await placeSalesCall(id);
      return back(reply, `/admin/leads/${id}`, r.message);
    } catch (e) {
      return back(reply, `/admin/leads/${id}`, `Call failed: ${(e as Error).message}`);
    }
  });

  app.post("/admin/leads/:id/preview", async (req, reply) => {
    const id = Number((req.params as Form).id);
    try {
      await buildPreview(id);
      return back(reply, `/admin/leads/${id}`, "Preview built");
    } catch (e) {
      return back(reply, `/admin/leads/${id}`, `Preview failed: ${(e as Error).message}`);
    }
  });

  app.post("/admin/leads/:id/enrich", async (req, reply) => {
    const id = Number((req.params as Form).id);
    updateLead(id, { line_type: null });
    await enrichLead(id);
    return back(reply, `/admin/leads/${id}`, "Re-checked");
  });

  app.post("/admin/leads/:id/update", async (req, reply) => {
    const id = Number((req.params as Form).id);
    const f = req.body as Form;
    updateLead(id, {
      status: f.status as Lead["status"],
      pitch: f.pitch as Lead["pitch"],
      contact_name: f.contact_name || null,
      mobile: toE164(f.mobile) ?? null,
      is_client: f.is_client === "1" ? 1 : 0,
    });
    if (f.note) appendLeadNote(id, f.note);
    return back(reply, `/admin/leads/${id}`, "Saved");
  });

  app.post("/admin/leads/:id/dnc", async (req, reply) => {
    const id = Number((req.params as Form).id);
    const lead = getLead(id);
    if (lead?.phone) addDnc(lead.phone, "marked in dashboard", "admin");
    if (lead?.mobile) addDnc(lead.mobile, "marked in dashboard", "admin");
    return back(reply, `/admin/leads/${id}`, "Added to do-not-call list");
  });

  // ---------- manual call list ----------
  app.get("/admin/manual", async (req, reply) => {
    const leads = manualQueue(150);
    const body = `
<h1>Call these yourself</h1>
<p class="muted">These numbers are cell phones (or similar). The law doesn't let the AI cold-call them without written consent, but you can call them yourself from your own phone. Tap to dial. Before you call a cell, check it against the National Do Not Call Registry (see docs/COMPLIANCE.md; your first five area codes are free).</p>
<table><tr><th>Score</th><th>Business</th><th>Why they need you</th><th>Preview</th><th></th></tr>
${leads
  .map((l) => {
    const audit = l.audit_json ? (JSON.parse(l.audit_json) as { issues?: string[] }) : null;
    return `<tr><td><b>${l.score}</b></td><td><a href="/admin/leads/${l.id}">${h(l.business_name)}</a><div class="muted">${h(l.category ?? "")} · ${h(l.line_type ?? "")}</div></td>
<td style="font-size:13px">${h(audit?.issues?.[0] ?? "")}</td>
<td>${l.preview_slug ? `<a href="${h(previewUrl(l))}" target="_blank">open</a>` : `<form class="inline" method="post" action="/admin/leads/${l.id}/preview"><button class="alt">build</button></form>`}</td>
<td><a class="btn" href="tel:${h(l.phone ?? "")}">Call ${h(formatPhone(l.phone ?? ""))}</a></td></tr>`;
  })
  .join("")}
</table>`;
    return page(reply, "Call yourself", body, req);
  });

  // ---------- calls ----------
  app.get("/admin/calls", async (req, reply) => {
    const calls = listCalls({ limit: 200 });
    const body = `<h1>Calls</h1><table><tr><th>When</th><th>Type</th><th>Who</th><th>Length</th><th>Outcome</th><th>Summary</th></tr>
${calls
  .map((c) => {
    const lead = c.lead_id ? getLead(c.lead_id) : undefined;
    const tenant = c.tenant_id ? getTenant(c.tenant_id) : undefined;
    const who = lead?.business_name ?? (tenant ? `${tenant.business_name} caller` : "");
    return `<tr><td><a href="/admin/calls/${h(c.call_sid)}">${when(c.started_at)}</a></td><td>${h(c.kind)} ${h(c.direction)}</td><td>${h(who)}<div class="muted">${h(formatPhone((c.direction === "inbound" ? c.from_number : c.to_number) ?? ""))}</div></td>
<td>${c.duration_sec ? `${Math.ceil(c.duration_sec / 60)} min` : ""}</td><td>${h(c.outcome ?? c.status ?? "")}</td><td style="font-size:13px">${h(c.summary ?? "")}</td></tr>`;
  })
  .join("")}</table>`;
    return page(reply, "Calls", body, req);
  });

  app.get("/admin/calls/:sid", async (req, reply) => {
    const c = getCall((req.params as Form).sid);
    if (!c) return reply.code(404).send("Not found");
    const lines = c.transcript_json ? (JSON.parse(c.transcript_json) as TranscriptLine[]) : [];
    const body = `<h1>Call ${when(c.started_at)}</h1>
<div class="card">${h(c.kind)} · ${h(c.direction)} · ${h(formatPhone(c.from_number ?? ""))} → ${h(formatPhone(c.to_number ?? ""))} · ${c.duration_sec ?? 0}s · ${h(c.outcome ?? c.status ?? "")}
${c.lead_id ? ` · <a href="/admin/leads/${c.lead_id}">lead</a>` : ""}${c.recording_url ? ` · <a href="${h(c.recording_url)}" target="_blank">recording</a> <span class="muted">(opens with your Twilio login)</span>` : ""}</div>
${c.summary ? `<div class="card"><b>Summary:</b> ${h(c.summary)}</div>` : ""}
<div class="transcript">${lines.map((l) => `<div class="${l.who}"><b>${l.who === "caller" ? "Caller" : l.who === "agent" ? `AI (${h(l.mode)})` : ""}</b> ${h(l.text)}</div>`).join("")}</div>`;
    return page(reply, "Call", body, req);
  });

  // ---------- receptionist clients ----------
  app.get("/admin/tenants", async (req, reply) => {
    const tenants = listTenants();
    const body = `<h1>Receptionist clients</h1>
<p class="muted">$${offer.receptionist.soloMonthly}/mo, or $${offer.receptionist.addonMonthly}/mo for website clients · ${offer.receptionist.minutesIncluded} minutes included.</p>
<table><tr><th>Business</th><th>AI number</th><th>Plan</th><th>Minutes this month</th><th>Status</th></tr>
${tenants
  .map(
    (t) =>
      `<tr><td><a href="/admin/tenants/${t.id}">${h(t.business_name)}</a></td><td>${h(t.phone_number ? formatPhone(t.phone_number) : "none yet")}</td><td>${h(t.plan)}</td><td>${tenantMinutesThisMonth(t.id)} / ${t.minutes_included}</td><td>${t.active ? '<span class="pill ok">live</span>' : '<span class="pill warn">off</span>'}</td></tr>`,
  )
  .join("")}</table>
<form class="card" method="post" action="/admin/tenants" style="margin-top:18px"><b>Add a client</b>
<div class="row"><div><label>Business name</label><input name="business_name" required></div><div><label>Owner name</label><input name="owner_name"></div><div><label>Owner cell</label><input name="owner_cell"></div><div><label>Owner email</label><input name="owner_email" type="email"></div></div>
<button style="margin-top:10px">Create</button></form>`;
    return page(reply, "Receptionist clients", body, req);
  });

  app.post("/admin/tenants", async (req, reply) => {
    const f = req.body as Form;
    const id = saveTenant({
      business_name: f.business_name,
      slug: `${slugify(f.business_name)}-${Date.now().toString(36)}`,
      owner_name: f.owner_name || null,
      owner_cell: toE164(f.owner_cell),
      owner_email: f.owner_email || null,
      timezone: config.TIMEZONE,
      minutes_included: offer.receptionist.minutesIncluded,
      active: 0,
    });
    return back(reply, `/admin/tenants/${id}`, "Client created. Fill in what the receptionist should know, get a number, then switch it on.");
  });

  app.get("/admin/tenants/:id", async (req, reply) => {
    const t = getTenant(Number((req.params as Form).id));
    if (!t) return reply.code(404).send("Not found");
    const q = req.query as Form;
    let numbers = "";
    if (q.area) {
      try {
        const list = await searchLocalNumbers(Number(q.area));
        numbers = list.length
          ? `<table>${list.map((n) => `<tr><td>${h(formatPhone(n.phoneNumber))}</td><td>${h(n.locality ?? "")}</td><td><form class="inline" method="post" action="/admin/tenants/${t.id}/buy"><input type="hidden" name="number" value="${h(n.phoneNumber)}"><button>Buy & connect</button></form></td></tr>`).join("")}</table>`
          : "<p>No numbers available in that area code.</p>";
      } catch (e) {
        numbers = `<p>${h((e as Error).message)}</p>`;
      }
    }
    const f = (name: keyof Tenant, label: string, type = "text") =>
      `<div><label>${label}</label><input name="${name}" type="${type}" value="${h(t[name] ?? "")}"></div>`;
    const body = `<h1>${h(t.business_name)} ${t.active ? '<span class="pill ok">live</span>' : '<span class="pill warn">off</span>'}</h1>
<form class="card" method="post" action="/admin/tenants/${t.id}">
<div class="row">${f("business_name", "Business name")}${f("agent_name", "Receptionist's name")}${f("owner_name", "Owner name")}${f("owner_cell", "Owner cell (messages + transfers)")}${f("owner_email", "Owner email")}</div>
<div class="row">${f("timezone", "Time zone")}${f("voice", "ElevenLabs voice (blank = default)")}${f("calcom_api_key", "Their Cal.com API key (optional)")}${f("calcom_event_type_id", "Cal.com event type ID", "number")}${f("booking_url", "Online booking link (optional)")}</div>
<label>Greeting (blank = "Thanks for calling ${h(t.business_name)}! This is ${h(t.agent_name)}, the virtual assistant. How can I help you?")</label><input name="greeting" value="${h(t.greeting ?? "")}">
<label>What the receptionist should know: services, prices they're OK sharing, hours, service area, FAQs, policies</label>
<textarea name="knowledge" style="min-height:260px">${h(t.knowledge)}</textarea>
<label>When to transfer a call to the owner</label><input name="transfer_rules" value="${h(t.transfer_rules ?? "")}" placeholder="e.g. burst pipes, no heat, gas smell, or the caller insists">
<div class="row"><div><label>Plan</label><select name="plan"><option value="solo" ${t.plan === "solo" ? "selected" : ""}>solo ($${offer.receptionist.soloMonthly}/mo)</option><option value="addon" ${t.plan === "addon" ? "selected" : ""}>website client ($${offer.receptionist.addonMonthly}/mo)</option></select></div>
${f("minutes_included", "Minutes included", "number")}
<div><label>Status</label><select name="active"><option value="0">off</option><option value="1" ${t.active ? "selected" : ""}>live</option></select></div></div>
<div style="margin-top:12px"><button>Save</button></div></form>
<div class="card"><b>AI phone number:</b> ${t.phone_number ? h(formatPhone(t.phone_number)) : "none yet"}
<p class="muted">The client forwards their business line to this number (all calls, or just when busy / no answer). Carrier forwarding codes are in docs/SETUP.md.</p>
<form method="get" class="row"><div><label>Find a number in area code</label><input name="area" value="${h(q.area ?? "252")}"></div><div style="flex:0 0 auto"><button class="alt">Search</button></div></form>${numbers}</div>
<h2>Recent calls</h2><table>${listCalls({ tenantId: t.id, limit: 30 }).map((c) => `<tr><td><a href="/admin/calls/${h(c.call_sid)}">${when(c.started_at)}</a></td><td>${h(formatPhone(c.from_number ?? ""))}</td><td>${h(c.summary ?? "")}</td></tr>`).join("")}</table>`;
    return page(reply, t.business_name, body, req);
  });

  app.post("/admin/tenants/:id", async (req, reply) => {
    const id = Number((req.params as Form).id);
    const f = req.body as Form;
    saveTenant(
      {
        business_name: f.business_name,
        agent_name: f.agent_name || "Sam",
        owner_name: f.owner_name || null,
        owner_cell: toE164(f.owner_cell),
        owner_email: f.owner_email || null,
        timezone: f.timezone || config.TIMEZONE,
        voice: f.voice || null,
        greeting: f.greeting || null,
        knowledge: f.knowledge ?? "",
        transfer_rules: f.transfer_rules || null,
        calcom_api_key: f.calcom_api_key || null,
        calcom_event_type_id: f.calcom_event_type_id ? Number(f.calcom_event_type_id) : null,
        booking_url: f.booking_url || null,
        plan: f.plan === "addon" ? "addon" : "solo",
        minutes_included: Number(f.minutes_included) || offer.receptionist.minutesIncluded,
        active: f.active === "1" ? 1 : 0,
      },
      id,
    );
    return back(reply, `/admin/tenants/${id}`, "Saved");
  });

  app.post("/admin/tenants/:id/buy", async (req, reply) => {
    const id = Number((req.params as Form).id);
    const t = getTenant(id);
    if (!t) return reply.code(404).send("Not found");
    try {
      const number = await buyNumber((req.body as Form).number, `AI receptionist: ${t.business_name}`);
      saveTenant({ business_name: t.business_name, phone_number: number }, id);
      return back(reply, `/admin/tenants/${id}`, `Bought ${formatPhone(number)} and connected it. Call it to test.`);
    } catch (e) {
      return back(reply, `/admin/tenants/${id}`, `Couldn't buy the number: ${(e as Error).message}`);
    }
  });

}
