import Link from "next/link";
import type { Metadata } from "next";

import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty";
import { Badge } from "@/components/ui/status";
import { requireUser } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { formatRelative } from "@/lib/format";
import { formatInstant, utcToDateKey } from "@/lib/kpi/dates";
import { formatRange } from "@/lib/kpi/dates";

export const metadata: Metadata = { title: "Snapshots" };
export const dynamic = "force-dynamic";

const STATUS_TONE = {
  CONFIRMED: "positive",
  NEEDS_REVIEW: "warning",
  FAILED: "negative",
  PROCESSING: "info",
  DRAFT: "neutral",
} as const;

const STATUS_LABEL = {
  CONFIRMED: "Confirmed",
  NEEDS_REVIEW: "Needs review",
  FAILED: "Failed",
  PROCESSING: "Processing",
  DRAFT: "Draft",
} as const;

export default async function SnapshotsPage() {
  const user = await requireUser();
  const snapshots = await prisma.snapshot.findMany({
    where: { userId: user.id },
    orderBy: { capturedAt: "desc" },
    take: 60,
    select: {
      id: true,
      capturedAt: true,
      status: true,
      imageCount: true,
      overallConfidence: true,
      extractionModel: true,
      extractionPromptVersion: true,
      reportingPeriodStart: true,
      reportingPeriodEnd: true,
      _count: { select: { observations: true } },
    },
  });

  return (
    <div>
      <PageHeader
        title="Snapshots"
        description="Every upload, kept as its own observation. Nothing is ever overwritten — uploading twice in one day creates two records, not one edit."
        actions={
          <Link href="/upload">
            <Button variant="primary">New snapshot</Button>
          </Link>
        }
      />
      <PageBody>
        {snapshots.length === 0 ? (
          <Card>
            <EmptyState
              title="No snapshots yet"
              description="Upload your Victra KPI screenshots and every capture will be listed here with its extraction confidence, the model that read it, and the values it produced."
              action={{ label: "Upload screenshots", href: "/upload" }}
            />
          </Card>
        ) : (
          <Card>
            <CardBody className="overflow-x-auto p-0">
              <table className="w-full min-w-[760px] text-left text-[13px]">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--surface-raised)] text-[11px] tracking-wide text-subtle uppercase">
                    <th scope="col" className="px-5 py-2.5 font-medium">Captured</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">Reporting period</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">Screens</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">Readings</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">Confidence</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">Model</th>
                    <th scope="col" className="px-5 py-2.5 text-right font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="tnum">
                  {snapshots.map((snapshot) => (
                    <tr
                      key={snapshot.id}
                      className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-raised)]"
                    >
                      <th scope="row" className="px-5 py-3 text-left font-normal">
                        <Link href={`/snapshots/${snapshot.id}`} className="block font-medium hover:underline">
                          {formatInstant(snapshot.capturedAt, user.timezone, "MMM d, h:mm a")}
                        </Link>
                        <span className="text-[11px] text-subtle">{formatRelative(snapshot.capturedAt)}</span>
                      </th>
                      <td className="px-3 py-3 text-muted">
                        {snapshot.reportingPeriodStart && snapshot.reportingPeriodEnd
                          ? formatRange(
                              utcToDateKey(snapshot.reportingPeriodStart),
                              utcToDateKey(snapshot.reportingPeriodEnd),
                            )
                          : "Not detected"}
                      </td>
                      <td className="px-3 py-3 text-right">{snapshot.imageCount}</td>
                      <td className="px-3 py-3 text-right">{snapshot._count.observations}</td>
                      <td className="px-3 py-3 text-right">
                        {snapshot.overallConfidence !== null
                          ? `${Math.round(snapshot.overallConfidence * 100)}%`
                          : "—"}
                      </td>
                      <td className="px-3 py-3">
                        <span className="font-mono text-[11px] text-muted">
                          {snapshot.extractionModel ?? "—"}
                        </span>
                        {snapshot.extractionPromptVersion && (
                          <span className="block font-mono text-[10px] text-subtle">
                            {snapshot.extractionPromptVersion}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <Badge tone={STATUS_TONE[snapshot.status]}>{STATUS_LABEL[snapshot.status]}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardBody>
          </Card>
        )}
      </PageBody>
    </div>
  );
}
