// A quick, honest check of a lead's current website. Everything flagged here is
// something the sales agent may say out loud, so only flag what we can verify.

export type WebsiteStatus = "none" | "social_only" | "broken" | "outdated" | "ok";

export interface Audit {
  status: WebsiteStatus;
  issues: string[];
  finalUrl?: string;
  httpStatus?: number;
  loadMs?: number;
  checkedAt: string;
}

const SOCIAL_HOSTS = [
  "facebook.com",
  "fb.com",
  "instagram.com",
  "yelp.com",
  "linktr.ee",
  "nextdoor.com",
  "angi.com",
  "homeadvisor.com",
  "thumbtack.com",
  "bbb.org",
  "yellowpages.com",
  "google.com",
  "business.site",
  "g.page",
];

const PARKED = [/domain (is )?for sale/i, /this domain (may be|is) for sale/i, /parked (free|domain)/i, /buy this domain/i, /future home of/i];

export function isSocialOnly(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host === "sites.google.com") return false; // a real (if basic) website
    return SOCIAL_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

export async function auditWebsite(url: string | null | undefined, timeoutMs = 12_000): Promise<Audit> {
  const checkedAt = new Date().toISOString();
  if (!url) return { status: "none", issues: ["No website on their Google listing"], checkedAt };
  if (isSocialOnly(url)) {
    return { status: "social_only", issues: ["Their Google listing links to a social or directory page instead of a website"], checkedAt };
  }
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
        Accept: "text/html",
      },
    });
  } catch (err) {
    const timedOut = (err as Error).name === "TimeoutError";
    return {
      status: "broken",
      issues: [timedOut ? "The website didn't load (timed out)" : "The website didn't load"],
      loadMs: Date.now() - started,
      checkedAt,
    };
  }
  const loadMs = Date.now() - started;
  const html = (await res.text().catch(() => "")).slice(0, 600_000);
  const finalUrl = res.url || url;
  const base = { finalUrl, httpStatus: res.status, loadMs, checkedAt };

  if (res.status >= 400) return { ...base, status: "broken", issues: [`The website returns an error (${res.status})`] };
  if (isSocialOnly(finalUrl)) {
    return { ...base, status: "social_only", issues: ["Their website address redirects to a social or directory page"] };
  }
  if (html.length < 400 || PARKED.some((re) => re.test(html))) {
    return { ...base, status: "broken", issues: ["The website address shows a parked or empty page"] };
  }

  const issues: string[] = [];
  let serious = 0;
  if (finalUrl.startsWith("http://")) {
    issues.push("The site isn't secure (browsers show a 'Not secure' warning)");
    serious++;
  }
  if (!/<meta[^>]+name=["']viewport["']/i.test(html)) {
    issues.push("The site isn't built for phones (no mobile layout)");
    serious++;
  }
  if (!/href=["']tel:/i.test(html)) issues.push("No tap-to-call phone link");
  if (loadMs > 5000) {
    issues.push(`The homepage took ${(loadMs / 1000).toFixed(1)} seconds to load`);
    serious++;
  }
  const years = [...html.matchAll(/(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})/gi)].map((m) => Number(m[1]));
  const latest = years.length ? Math.max(...years) : null;
  if (latest && latest < new Date().getFullYear() - 3) {
    issues.push(`The copyright date on the site says ${latest}, so it looks unmaintained`);
  }
  if (!/<title>[^<]{3,}<\/title>/i.test(html)) issues.push("The homepage has no page title for Google");

  const status: WebsiteStatus = serious >= 1 || issues.length >= 3 ? "outdated" : "ok";
  return { ...base, status, issues };
}
