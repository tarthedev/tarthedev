import type { DashboardData } from "@/lib/kpi/dashboard";

export type AlertSeverity = "INFO" | "WARNING" | "CRITICAL";

export interface Alert {
  kind: string;
  title: string;
  body: string;
  severity: AlertSeverity;
  /** Stable per period so the same alert is not raised twice. */
  dedupeKey: string;
  kpiKey?: string;
}

/**
 * Deterministic alert generation — no model call. These render in-app today and
 * are shaped so an email or push channel can consume the same objects later
 * without touching this logic.
 */
export function evaluateAlerts(data: DashboardData): Alert[] {
  const alerts: Alert[] = [];
  const scope = `${data.period.start}:${data.period.end}`;
  const unit = data.unitLabel;

  for (const row of data.rows) {
    if (row.targetValue <= 0) continue;
    const pace = row.pace;

    if (pace.status === "BEHIND") {
      alerts.push({
        kind: "kpi_behind",
        kpiKey: row.key,
        severity: "CRITICAL",
        title: `Behind pace on ${row.displayName}`,
        body:
          pace.requiredRate === null
            ? `${row.displayName} finished at ${pace.current} of ${pace.target}.`
            : `${pace.current} of ${pace.target}. You need ${pace.remaining} more across ${pace.unitsRemaining} remaining ${unit}${pace.unitsRemaining === 1 ? "" : "s"} — ${pace.requiredRate.toFixed(2)} per ${unit}.`,
        dedupeKey: `kpi_behind:${row.key}:${scope}`,
      });
    } else if (pace.status === "AT_RISK") {
      alerts.push({
        kind: "kpi_at_risk",
        kpiKey: row.key,
        severity: "WARNING",
        title: `${row.displayName} is slipping`,
        body: `${pace.current} of ${pace.target}, tracking to finish at ${pace.projected}. ${
          pace.nextUnitTarget ?? 0
        } on your next ${unit} puts you back on pace.`,
        dedupeKey: `kpi_at_risk:${row.key}:${scope}`,
      });
    } else if (pace.status === "COMPLETE") {
      alerts.push({
        kind: "kpi_complete",
        kpiKey: row.key,
        severity: "INFO",
        title: `${row.displayName} goal hit`,
        body: `${pace.current} of ${pace.target} with ${pace.unitsRemaining} ${unit}${
          pace.unitsRemaining === 1 ? "" : "s"
        } left.`,
        dedupeKey: `kpi_complete:${row.key}:${scope}`,
      });
    } else if (pace.status === "AHEAD" && pace.projectedAttainmentPct >= 115) {
      alerts.push({
        kind: "kpi_ahead",
        kpiKey: row.key,
        severity: "INFO",
        title: `Projected to beat ${row.displayName}`,
        body: `At your current pace you finish at ${pace.projected} against a goal of ${pace.target} (${pace.projectedAttainmentPct.toFixed(0)}%).`,
        dedupeKey: `kpi_ahead:${row.key}:${scope}`,
      });
    }
  }

  if (data.pendingReviewCount > 0) {
    alerts.push({
      kind: "review_pending",
      severity: "WARNING",
      title: `${data.pendingReviewCount} snapshot${data.pendingReviewCount === 1 ? "" : "s"} awaiting review`,
      body: "Values from those uploads are not counting toward your dashboard until you confirm them.",
      dedupeKey: `review_pending:${data.pendingReviewCount}:${data.today}`,
    });
  }

  const stale = data.lastSnapshot === null;
  if (stale && data.rows.length > 0) {
    alerts.push({
      kind: "no_data",
      severity: "INFO",
      title: "No confirmed KPI data yet",
      body: "Upload your Victra KPI screenshots to start tracking pace and projections.",
      dedupeKey: `no_data:${data.today}`,
    });
  }

  const order: Record<AlertSeverity, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 };
  return alerts.sort((a, b) => order[a.severity] - order[b.severity]);
}
