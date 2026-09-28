import { config } from "../config.js";
import type { Lead } from "../db.js";
import { escapeHtml as e } from "../lib/util.js";
import { formatPhone, offer } from "../offer.js";
import type { PreviewData } from "./generate.js";

const PALETTES: Record<string, { c: string; dk: string; tint: string }> = {
  forest: { c: "#14684B", dk: "#0D4D38", tint: "#EAF3EF" },
  navy: { c: "#1F3A5F", dk: "#142840", tint: "#E9EEF5" },
  brick: { c: "#A23B2A", dk: "#7A2B1E", tint: "#F7ECE9" },
  slate: { c: "#334155", dk: "#1E293B", tint: "#EEF1F5" },
  teal: { c: "#0F766E", dk: "#0B5A54", tint: "#E6F4F2" },
  amber: { c: "#B45309", dk: "#8A3F06", tint: "#FBF1E4" },
  plum: { c: "#6B2F5F", dk: "#4F2146", tint: "#F4EAF2" },
};

function stars(rating: number): string {
  const full = Math.round(rating);
  return "★★★★★".slice(0, full) + "☆☆☆☆☆".slice(0, 5 - full);
}

/** The free preview website for a lead: their name, number, reviews, and hours on a real page. */
export function renderPreview(lead: Lead, data: PreviewData): string {
  const { copy } = data;
  const pal = PALETTES[copy.theme] ?? PALETTES.forest;
  const phone = lead.phone ? formatPhone(lead.phone) : null;
  const tel = lead.phone ? `tel:${lead.phone}` : null;
  const sms = lead.phone ? `sms:${lead.phone}` : null;
  const hours = lead.hours_json ? (JSON.parse(lead.hours_json) as string[]) : [];
  const town = [lead.city, lead.state].filter(Boolean).join(", ");
  const mapQuery = encodeURIComponent(lead.address ?? `${lead.business_name} ${town}`);
  const aaronSms = `sms:${config.OWNER_CELL}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${e(lead.business_name)}${town ? ` · ${e(town)}` : ""}</title>
<meta name="description" content="${e(copy.subheadline)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  :root{--c:${pal.c};--dk:${pal.dk};--tint:${pal.tint};--ink:#1d1d1f;--muted:#5f6368;--rule:#e3e3e0;--paper:#fff}
  *{box-sizing:border-box;margin:0;padding:0}
  html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
  body{font-family:Figtree,system-ui,-apple-system,'Segoe UI',sans-serif;color:var(--ink);background:var(--paper);line-height:1.55;font-size:17px;padding-bottom:76px}
  a{color:var(--c)}
  .wrap{max-width:980px;margin:0 auto;padding:0 20px}
  .notice{background:#241E1A;color:#fff;font-size:13.5px;padding:9px 0;text-align:center}
  .notice a{color:#9BE3C4;font-weight:600;text-decoration:none;white-space:nowrap}
  header{border-bottom:1px solid var(--rule);background:#fff;position:sticky;top:0;z-index:5}
  header .wrap{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:62px}
  .brand{font-weight:800;font-size:18px;letter-spacing:-.01em;line-height:1.2}
  .brand small{display:block;font-weight:500;font-size:12.5px;color:var(--muted)}
  .hcall{background:var(--c);color:#fff;text-decoration:none;font-weight:700;padding:10px 16px;border-radius:999px;font-size:15px;white-space:nowrap}
  .hero{background:var(--c);color:#fff;padding:54px 0 58px;position:relative;overflow:hidden}
  .hero::after{content:"";position:absolute;right:-120px;top:-120px;width:380px;height:380px;border-radius:50%;background:rgba(255,255,255,.06)}
  .hero h1{font-size:clamp(32px,7.4vw,54px);line-height:1.06;letter-spacing:-.03em;font-weight:800;max-width:17ch;margin-bottom:16px}
  .hero p{font-size:19px;opacity:.9;max-width:44ch;margin-bottom:26px}
  .rating{display:inline-flex;align-items:center;gap:8px;background:rgba(255,255,255,.14);padding:6px 12px;border-radius:999px;font-size:14.5px;font-weight:600;margin-bottom:18px}
  .rating b{color:#FFD66B;letter-spacing:1px}
  .btns{display:flex;flex-wrap:wrap;gap:12px}
  .btn{display:inline-block;text-decoration:none;font-weight:700;font-size:17px;padding:15px 22px;border-radius:10px;text-align:center}
  .btn.primary{background:#fff;color:var(--dk)}
  .btn.ghost{border:2px solid rgba(255,255,255,.7);color:#fff}
  .highlights{display:grid;gap:10px;padding:26px 0;border-bottom:1px solid var(--rule)}
  .highlights div{display:flex;gap:10px;align-items:flex-start;font-weight:600}
  .highlights div::before{content:"✓";color:var(--c);font-weight:800}
  section{padding:48px 0}
  h2{font-size:clamp(24px,5vw,32px);letter-spacing:-.02em;line-height:1.15;margin-bottom:20px}
  .services{display:grid;gap:14px}
  .svc{border:1px solid var(--rule);border-radius:12px;padding:20px;background:#fff}
  .svc h3{font-size:18px;margin-bottom:6px}
  .svc p{color:var(--muted);font-size:16px}
  .tint{background:var(--tint)}
  .reviews{display:grid;gap:14px}
  blockquote{background:#fff;border-radius:12px;padding:20px;border-left:4px solid var(--c)}
  blockquote .s{color:#E0A100;letter-spacing:1px;font-size:15px}
  blockquote p{margin:6px 0 10px;font-size:16.5px}
  blockquote cite{font-style:normal;color:var(--muted);font-size:14px}
  .two{display:grid;gap:30px}
  .hours li{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid var(--rule);list-style:none;font-size:15.5px}
  .map{width:100%;height:260px;border:0;border-radius:12px;margin-top:14px;background:var(--tint)}
  details{border-bottom:1px solid var(--rule);padding:14px 0}
  summary{font-weight:700;cursor:pointer;list-style:none}
  summary::-webkit-details-marker{display:none}
  summary::after{content:"+";float:right;color:var(--c);font-weight:800}
  details[open] summary::after{content:"–"}
  details p{color:var(--muted);margin-top:8px}
  .final{background:var(--dk);color:#fff;text-align:center}
  .final h2{color:#fff}
  .final p{opacity:.85;margin-bottom:22px}
  .pitch{border:2px dashed #241E1A;border-radius:12px;padding:22px;margin:40px 0 10px;background:#FFFDF6}
  .pitch h3{font-size:18px;margin-bottom:6px}
  .pitch p{font-size:15.5px;color:#4a4540;margin-bottom:12px}
  .pitch a{font-weight:700}
  footer{padding:26px 0 30px;color:var(--muted);font-size:14px;border-top:1px solid var(--rule)}
  .sticky{position:fixed;left:0;right:0;bottom:0;background:#fff;border-top:1px solid var(--rule);padding:10px 16px;display:flex;gap:10px;z-index:9}
  .sticky a{flex:1;text-align:center;text-decoration:none;font-weight:700;padding:13px;border-radius:10px}
  .sticky .call{background:var(--c);color:#fff}
  .sticky .text{border:2px solid var(--c);color:var(--c)}
  @media (min-width:760px){
    .highlights{grid-template-columns:repeat(3,1fr)}
    .services{grid-template-columns:repeat(2,1fr)}
    .reviews{grid-template-columns:repeat(${Math.max(1, Math.min(3, data.reviews.length))},1fr)}
    .two{grid-template-columns:1fr 1fr}
    .sticky{display:none}
    body{padding-bottom:0}
  }
  @media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
</style>
</head>
<body>

<div class="notice">Free preview built for ${e(lead.business_name)} by ${e(config.BUSINESS_NAME)} · not live yet · <a href="${aaronSms}">Like it? Text ${e(config.OWNER_FIRST_NAME)}</a></div>

<header>
  <div class="wrap">
    <div class="brand">${e(lead.business_name)}${lead.category ? `<small>${e(lead.category)}${town ? ` · ${e(town)}` : ""}</small>` : ""}</div>
    ${tel ? `<a class="hcall" href="${tel}">Call now</a>` : ""}
  </div>
</header>

<div class="hero">
  <div class="wrap">
    ${lead.rating ? `<div class="rating"><b>${stars(lead.rating)}</b> ${lead.rating.toFixed(1)} · ${lead.review_count ?? 0} Google reviews</div>` : ""}
    <h1>${e(copy.headline)}</h1>
    <p>${e(copy.subheadline)}</p>
    <div class="btns">
      ${tel ? `<a class="btn primary" href="${tel}">Call ${e(phone!)}</a>` : ""}
      ${sms ? `<a class="btn ghost" href="${sms}">Send a text</a>` : ""}
    </div>
  </div>
</div>

<div class="wrap">
  <div class="highlights">${copy.highlights.slice(0, 3).map((h) => `<div>${e(h)}</div>`).join("")}</div>
</div>

<section>
  <div class="wrap">
    <h2>What we do</h2>
    <div class="services">
      ${copy.services.slice(0, 6).map((s) => `<div class="svc"><h3>${e(s.name)}</h3><p>${e(s.description)}</p></div>`).join("")}
    </div>
  </div>
</section>

${
  data.reviews.length
    ? `<section class="tint">
  <div class="wrap">
    <h2>What customers say</h2>
    <div class="reviews">
      ${data.reviews
        .map(
          (r) =>
            `<blockquote><div class="s">${stars(r.rating)}</div><p>“${e(r.quote)}”</p><cite>${e(r.author)} · Google review</cite></blockquote>`,
        )
        .join("")}
    </div>
  </div>
</section>`
    : ""
}

<section>
  <div class="wrap two">
    <div>
      <h2>About us</h2>
      <p>${e(copy.about)}</p>
      <p style="margin-top:14px"><b>Service area:</b> ${e(copy.service_area)}</p>
    </div>
    <div>
      <h2>Hours &amp; location</h2>
      ${hours.length ? `<ul class="hours">${hours.map((h) => { const [d, ...rest] = h.split(": "); return `<li><span>${e(d)}</span><span>${e(rest.join(": "))}</span></li>`; }).join("")}</ul>` : "<p>Call for hours.</p>"}
      ${lead.address ? `<p style="margin-top:12px">${e(lead.address)}</p>` : ""}
      <iframe class="map" loading="lazy" title="Map" src="https://maps.google.com/maps?q=${mapQuery}&output=embed"></iframe>
    </div>
  </div>
</section>

<section class="tint">
  <div class="wrap">
    <h2>Questions</h2>
    ${copy.faq.slice(0, 4).map((f) => `<details><summary>${e(f.question)}</summary><p>${e(f.answer)}</p></details>`).join("")}
  </div>
</section>

<section class="final">
  <div class="wrap">
    <h2>Ready when you are</h2>
    <p>${e(copy.service_area)}</p>
    ${tel ? `<a class="btn primary" href="${tel}">Call ${e(phone!)}</a>` : ""}
  </div>
</section>

<div class="wrap">
  <div class="pitch">
    <h3>This is a free preview from ${e(config.BUSINESS_NAME)}</h3>
    <p>${e(config.OWNER_FIRST_NAME)} built this for ${e(lead.business_name)} before asking for anything. Anything wrong (services, hours, colors) gets fixed. It goes live in about a week for $${offer.website.price.toLocaleString()}, and you pay when you're happy with it, not before.</p>
    <p><a href="${aaronSms}">Text ${e(config.OWNER_FIRST_NAME)} at ${e(formatPhone(config.OWNER_CELL))}</a> · <a href="mailto:${e(config.OWNER_EMAIL)}">${e(config.OWNER_EMAIL)}</a></p>
  </div>
</div>

<footer>
  <div class="wrap">© ${new Date().getFullYear()} ${e(lead.business_name)} · Website by ${e(config.BUSINESS_NAME)}</div>
</footer>

${tel ? `<div class="sticky"><a class="call" href="${tel}">Call</a>${sms ? `<a class="text" href="${sms}">Text</a>` : ""}</div>` : ""}

<script>
  // Count a view only when a person actually has the page open (link-preview bots don't run scripts).
  setTimeout(function(){try{fetch(location.pathname.replace(/\\/$/,"")+"/view",{method:"POST",keepalive:true})}catch(e){}},1500);
</script>
</body>
</html>`;
}

/** Simple branded page in the rollinsonnetwork.com style (checkout thank-you, errors). */
export function simplePage(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${e(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;600;700&display=swap" rel="stylesheet">
<style>body{font-family:'Instrument Sans',system-ui,sans-serif;color:#241E1A;background:#fff;line-height:1.55;font-size:17px;margin:0}
.wrap{max-width:620px;margin:0 auto;padding:40px 22px}.mark{font-weight:700;margin-bottom:40px}.mark span{color:#6B635C;font-weight:400}
h1{font-size:32px;letter-spacing:-.03em;line-height:1.1;margin:0 0 14px}p{color:#6B635C}a{color:#14684B}</style></head>
<body><div class="wrap"><div class="mark">${e(config.BUSINESS_NAME)} <span>— websites for local business</span></div><h1>${e(title)}</h1>${bodyHtml}</div></body></html>`;
}
