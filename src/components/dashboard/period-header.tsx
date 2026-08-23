import Link from "next/link";
import { CalendarDays, Clock } from "lucide-react";

import { ProgressBar } from "@/components/ui/progress";
import { formatPercent } from "@/lib/format";
import { hourInTz } from "@/lib/kpi/dates";
import type { DashboardData } from "@/lib/kpi/dashboard";

function greeting(timezone: string): string {
  const hour = hourInTz(timezone);
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** Answers "how am I doing" above the fold, before any scrolling. */
export function PeriodHeader({ data, name }: { data: DashboardData; name: string | null }) {
  const scored = data.overall.components.length > 0;

  return (
    <header className="border-b border-[var(--border)] bg-[var(--surface)] px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">
            {greeting(data.timezone)}
            {name ? `, ${name.split(" ")[0]}` : ""}.
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted">
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="size-3.5" aria-hidden="true" />
              {data.period.label}
            </span>
            <span className="inline-flex items-center gap-1.5 tnum">
              <Clock className="size-3.5" aria-hidden="true" />
              {data.unitsRemaining} {data.unitLabel}
              {data.unitsRemaining === 1 ? "" : "s"} remaining
              {data.scheduledHoursRemaining !== null && ` · ${data.scheduledHoursRemaining}h scheduled`}
            </span>
          </div>
        </div>

        {scored && (
          <div className="w-full sm:w-64">
            <div className="flex items-baseline justify-between">
              <Link
                href="/scorecard"
                className="text-[11px] font-medium tracking-wide text-subtle uppercase hover:text-[var(--text-muted)]"
              >
                Overall score
              </Link>
              <span className="text-2xl leading-none font-semibold tracking-tight tnum">
                {formatPercent(data.overall.score)}
              </span>
            </div>
            <ProgressBar
              className="mt-2"
              value={Math.min(100, data.overall.score)}
              status={data.overall.score >= 100 ? "COMPLETE" : data.overall.score >= 90 ? "ON_TRACK" : data.overall.score >= 75 ? "AT_RISK" : "BEHIND"}
              paceMarkerPct={data.unitsTotal > 0 ? (data.unitsEngaged / data.unitsTotal) * 100 : null}
              label="Overall weighted score"
            />
            <p className="mt-1.5 text-[11px] text-subtle">
              Weighted goal attainment. The line marks an even pace.
            </p>
          </div>
        )}
      </div>
    </header>
  );
}
