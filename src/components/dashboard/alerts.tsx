import { AlertTriangle, CheckCircle2, Info } from "lucide-react";

import type { Alert } from "@/lib/kpi/alerts";
import { cn } from "@/lib/cn";

const ICONS = {
  CRITICAL: AlertTriangle,
  WARNING: AlertTriangle,
  INFO: Info,
} as const;

const TONES = {
  CRITICAL: "border-[var(--negative)] bg-[var(--negative-bg)] text-[var(--negative)]",
  WARNING: "border-[var(--warning)] bg-[var(--warning-bg)] text-[var(--warning)]",
  INFO: "border-[var(--border)] bg-[var(--surface-raised)] text-[var(--text-muted)]",
} as const;

/** Deterministic alerts — computed from the numbers, never from a model. */
export function AlertList({ alerts, limit = 3 }: { alerts: Alert[]; limit?: number }) {
  const shown = alerts.filter((a) => a.severity !== "INFO" || a.kind === "no_data").slice(0, limit);
  if (shown.length === 0) return null;

  return (
    <ul className="space-y-2">
      {shown.map((alert) => {
        const Icon = alert.kind === "kpi_complete" ? CheckCircle2 : ICONS[alert.severity];
        return (
          <li key={alert.dedupeKey} className={cn("flex gap-3 rounded-lg border px-4 py-3", TONES[alert.severity])}>
            <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-sm font-medium">{alert.title}</p>
              <p className="mt-0.5 text-[13px] leading-relaxed opacity-90">{alert.body}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
