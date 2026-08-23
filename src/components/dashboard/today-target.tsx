import Link from "next/link";
import { Target } from "lucide-react";

import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { statusTextClass } from "@/components/ui/status";
import type { TodayTarget } from "@/lib/kpi/dashboard";

/**
 * The single most-used card: what to sell before the shift ends. Derived from
 * goal, current production and remaining shifts — never typed in by hand.
 */
export function TodaysTargetCard({
  targets,
  unitLabel,
  todayCounted,
}: {
  targets: TodayTarget[];
  unitLabel: "day" | "shift";
  todayCounted: boolean;
}) {
  const heading = todayCounted ? `Next ${unitLabel}'s target` : "Today's target";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{heading}</CardTitle>
        <Target className="size-4 text-[var(--text-subtle)]" aria-hidden="true" />
      </CardHeader>
      <CardBody>
        {targets.length === 0 ? (
          <p className="text-sm text-muted">
            Nothing outstanding — every KPI with a goal is already at target.{" "}
            <Link href="/goals" className="underline underline-offset-2">
              Set more goals
            </Link>{" "}
            to keep the pressure on.
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
            {targets.map((target) => (
              <li key={target.key}>
                <Link href={`/kpi/${target.key}`} className="group block">
                  <p className="truncate text-[11px] text-subtle group-hover:text-[var(--text-muted)]">
                    {target.displayName}
                  </p>
                  <p className={`mt-0.5 text-2xl leading-none font-semibold tnum ${statusTextClass(target.status)}`}>
                    {target.needed}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {targets.length > 0 && (
          <p className="mt-4 text-[11px] text-subtle">
            What each KPI needs on your next working {unitLabel} to finish the period on target.
          </p>
        )}
      </CardBody>
    </Card>
  );
}
