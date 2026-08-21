import type { UnitType } from "@/lib/kpi/pace";

/** Formats a KPI value for display according to its unit. */
export function formatValue(value: number, unitType: UnitType = "COUNT"): string {
  if (!Number.isFinite(value)) return "—";
  switch (unitType) {
    case "CURRENCY":
      return value.toLocaleString(undefined, {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: value % 1 === 0 ? 0 : 2,
      });
    case "PERCENT":
      return `${trim(value)}%`;
    case "RATIO":
      return trim(value, 2);
    case "COUNT":
    default:
      return Number.isInteger(value) ? value.toLocaleString() : trim(value, 1);
  }
}

function trim(value: number, dp = 1): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(dp).replace(/\.?0+$/, "");
}

/** Percentages are shown without decimals unless the value is under 10%. */
export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return value >= 10 || value === 0 ? `${Math.round(value)}%` : `${value.toFixed(1)}%`;
}

/** Rates read better at two decimals — "1.67/day" is the whole point. */
export function formatRate(value: number | null, unitLabel: string, unitType: UnitType = "COUNT"): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const rounded = Math.round(value * 100) / 100;
  const amount =
    unitType === "CURRENCY" || unitType === "PERCENT"
      ? formatValue(rounded, unitType)
      : Number.isInteger(rounded)
        ? String(rounded)
        : rounded.toFixed(2);
  return `${amount}/${unitLabel}`;
}

export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "$0.00";
  if (value !== 0 && Math.abs(value) < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

export function formatRelative(date: Date | string, now: Date = new Date()): string {
  const then = typeof date === "string" ? new Date(date) : date;
  const seconds = Math.round((now.getTime() - then.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
