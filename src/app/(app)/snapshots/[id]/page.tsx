import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { PageBody, PageHeader } from "@/components/layout/page-header";
import { ReviewPanel, type ReviewObservation } from "@/components/snapshot/review-panel";
import { SnapshotActions } from "@/components/snapshot/snapshot-actions";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorNote } from "@/components/ui/empty";
import { Badge } from "@/components/ui/status";
import { requireUser } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { formatUsd } from "@/lib/format";
import { formatInstant, formatRange, utcToDateKey } from "@/lib/kpi/dates";

export const metadata: Metadata = { title: "Snapshot" };
export const dynamic = "force-dynamic";

const STATUS_TONE = {
  CONFIRMED: "positive",
  NEEDS_REVIEW: "warning",
  FAILED: "negative",
  PROCESSING: "info",
  DRAFT: "neutral",
} as const;

export default async function SnapshotDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();

  const snapshot = await prisma.snapshot.findFirst({
    where: { id, userId: user.id },
    include: {
      images: { orderBy: { orderIndex: "asc" } },
      observations: {
        orderBy: [{ status: "asc" }, { rawLabel: "asc" }],
        include: { kpi: { select: { id: true, key: true, displayName: true } }, sourceImage: { select: { id: true, label: true } } },
      },
      attempts: { orderBy: { attemptNumber: "asc" } },
    },
  });
  if (!snapshot) notFound();

  const kpiOptions = await prisma.kpiDefinition.findMany({
    where: { userId: user.id, active: true },
    orderBy: { sortOrder: "asc" },
    select: { id: true, key: true, displayName: true },
  });

  const observations: ReviewObservation[] = snapshot.observations.map((o) => ({
    id: o.id,
    rawLabel: o.rawLabel,
    rawValue: o.rawValue,
    value: o.value,
    aiValue: o.aiValue,
    confidence: o.confidence,
    status: o.status,
    isCorrected: o.isCorrected,
    notes: o.notes,
    sourceImageLabel: o.sourceImage?.label ?? null,
    sourceImageId: o.sourceImage?.id ?? null,
    kpi: o.kpi,
  }));

  const totalCost = snapshot.attempts.reduce((sum, a) => sum + a.costUsd, 0);

  return (
    <div>
      <PageHeader
        title={formatInstant(snapshot.capturedAt, user.timezone, "MMM d, yyyy 'at' h:mm a")}
        description={
          snapshot.reportingPeriodStart && snapshot.reportingPeriodEnd
            ? `Reporting period detected: ${formatRange(utcToDateKey(snapshot.reportingPeriodStart), utcToDateKey(snapshot.reportingPeriodEnd))}`
            : "No reporting period was visible on these screenshots."
        }
        actions={<Badge tone={STATUS_TONE[snapshot.status]}>{snapshot.status.replace("_", " ")}</Badge>}
      />
      <PageBody>
        {snapshot.errorMessage && <ErrorNote>{snapshot.errorMessage}</ErrorNote>}

        {observations.length > 0 ? (
          <ReviewPanel
            snapshotId={snapshot.id}
            observations={observations}
            kpiOptions={kpiOptions}
            imageUrlFor={(imageId) => `/api/snapshots/${snapshot.id}/images/${imageId}?size=thumb`}
          />
        ) : (
          <Card>
            <CardBody className="pt-5">
              <p className="text-sm text-muted">
                No values were extracted from this snapshot. Use &quot;Retry with deep model&quot; below, or delete it
                and upload clearer screenshots.
              </p>
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Screenshots</CardTitle>
            <span className="text-[11px] text-subtle tnum">{snapshot.images.length} images</span>
          </CardHeader>
          <CardBody>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {snapshot.images.map((image) => (
                <li key={image.id} className="overflow-hidden rounded-lg border border-[var(--border)]">
                  <a
                    href={`/api/snapshots/${snapshot.id}/images/${image.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="block"
                  >
                    {/* Served through the authenticated route, so next/image cannot optimise it. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/snapshots/${snapshot.id}/images/${image.id}?size=thumb`}
                      alt={`${image.label} — ${image.originalName}`}
                      className="aspect-[3/5] w-full bg-[var(--surface-sunken)] object-cover object-top"
                      loading="lazy"
                    />
                  </a>
                  <div className="px-2 py-1.5">
                    <p className="truncate font-mono text-[11px] text-muted">{image.label}</p>
                    <p className="truncate text-[10px] text-subtle tnum">
                      {image.width}×{image.height}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Extraction attempts</CardTitle>
              <span className="text-[11px] text-subtle tnum">{formatUsd(totalCost)}</span>
            </CardHeader>
            <CardBody className="overflow-x-auto p-0">
              <table className="w-full min-w-[440px] text-left text-[12px]">
                <thead>
                  <tr className="border-y border-[var(--border)] bg-[var(--surface-raised)] text-[10px] tracking-wide text-subtle uppercase">
                    <th scope="col" className="px-4 py-2 font-medium">#</th>
                    <th scope="col" className="px-3 py-2 font-medium">Strategy</th>
                    <th scope="col" className="px-3 py-2 font-medium">Model</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Tokens</th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">Result</th>
                  </tr>
                </thead>
                <tbody className="tnum">
                  {snapshot.attempts.map((attempt) => (
                    <tr key={attempt.id} className="border-b border-[var(--border)] last:border-0">
                      <td className="px-4 py-2">{attempt.attemptNumber}</td>
                      <td className="px-3 py-2 text-muted">{attempt.strategy}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-muted">{attempt.model}</td>
                      <td className="px-3 py-2 text-right text-muted">
                        {attempt.inputTokens.toLocaleString()} / {attempt.outputTokens.toLocaleString()}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {attempt.success ? (
                          <Badge tone="positive">OK</Badge>
                        ) : (
                          <Badge tone="negative" >Failed</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                  {snapshot.attempts.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-4 text-muted">
                        Not processed yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Audit</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3 text-[12px]">
              <dl className="grid grid-cols-2 gap-y-2">
                <dt className="text-subtle">Model</dt>
                <dd className="text-right font-mono">{snapshot.extractionModel ?? "—"}</dd>
                <dt className="text-subtle">Prompt version</dt>
                <dd className="text-right font-mono">{snapshot.extractionPromptVersion ?? "—"}</dd>
                <dt className="text-subtle">Mean confidence</dt>
                <dd className="text-right tnum">
                  {snapshot.overallConfidence !== null
                    ? `${Math.round(snapshot.overallConfidence * 100)}%`
                    : "—"}
                </dd>
                <dt className="text-subtle">Snapshot id</dt>
                <dd className="truncate text-right font-mono">{snapshot.id}</dd>
              </dl>

              {snapshot.rawExtraction !== null && (
                <details className="rounded-lg border border-[var(--border)] p-3">
                  <summary className="cursor-pointer text-[12px] font-medium">Raw model output</summary>
                  <pre className="mt-2 max-h-72 overflow-auto rounded bg-[var(--surface-sunken)] p-2 font-mono text-[10px] leading-relaxed">
                    {JSON.stringify(snapshot.rawExtraction, null, 2)}
                  </pre>
                </details>
              )}

              <SnapshotActions snapshotId={snapshot.id} />
            </CardBody>
          </Card>
        </div>
      </PageBody>
    </div>
  );
}
