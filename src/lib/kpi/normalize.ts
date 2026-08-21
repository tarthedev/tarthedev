/**
 * Maps free-text KPI labels read off a screenshot onto the user's stable KPI
 * keys. Deliberately conservative: an unrecognised label becomes an UNMAPPED
 * observation the user is asked about, never a silent guess.
 */

export interface KpiLike {
  id: string;
  key: string;
  displayName: string;
  aliases: string[];
}

/** "Internet Sales!" → "internet_sales" */
export function normalizeKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Collapses a label to a comparison form: "VMP %" and "vmp" both → "vmp". */
function comparable(raw: string): string {
  return normalizeKey(raw).replace(/_/g, "");
}

export function matchKpi(
  candidates: { key?: string | null; label?: string | null },
  definitions: KpiLike[],
): KpiLike | null {
  const probes = [candidates.key, candidates.label].filter(
    (v): v is string => typeof v === "string" && v.trim().length > 0,
  );
  if (probes.length === 0) return null;

  // Exact key match first — the model is asked to echo known keys verbatim.
  for (const probe of probes) {
    const exact = definitions.find((d) => d.key === probe);
    if (exact) return exact;
  }

  for (const probe of probes) {
    const norm = comparable(probe);
    const hit = definitions.find(
      (d) =>
        comparable(d.key) === norm ||
        comparable(d.displayName) === norm ||
        d.aliases.some((a) => comparable(a) === norm),
    );
    if (hit) return hit;
  }

  return null;
}

/** Parses "1,234", "87%", "$1,299.50", "12 / 15" (takes the numerator). */
export function parseNumericValue(raw: string): number | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  // "7 / 12" and "7 of 12" report progress; the first number is the value.
  const ratio = trimmed.match(/^([-+]?[\d,]*\.?\d+)\s*(?:\/|of)\s*[-+]?[\d,]*\.?\d+$/i);
  const candidate = ratio?.[1] ?? trimmed;

  const cleaned = candidate.replace(/[$,\s%]/g, "");
  if (!/^[-+]?\d*\.?\d+$/.test(cleaned)) return null;

  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : null;
}
