import type { Metadata } from "next";
import { Download } from "lucide-react";

import { PageBody, PageHeader } from "@/components/layout/page-header";
import { KpiManager } from "@/components/settings/kpi-manager";
import { SettingsForm } from "@/components/settings/settings-form";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { env, isMockAi } from "@/lib/env";
import { getSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

const EXPORTS = [
  { dataset: "observations", label: "KPI readings", description: "Every extracted value with its AI reading, correction and confidence." },
  { dataset: "snapshots", label: "Snapshots", description: "Upload history with model, prompt version and confidence." },
  { dataset: "goals", label: "Goals", description: "Every goal you have set, by period." },
  { dataset: "usage", label: "AI usage", description: "Token counts and estimated cost per request." },
];

export default async function SettingsPage() {
  const user = await requireUser();
  const [settings, kpis, counts] = await Promise.all([
    getSettings(user.id),
    prisma.kpiDefinition.findMany({
      where: { userId: user.id },
      orderBy: [{ active: "desc" }, { sortOrder: "asc" }],
    }),
    prisma.$transaction([
      prisma.snapshot.count({ where: { userId: user.id } }),
      prisma.metricObservation.count({ where: { userId: user.id } }),
      prisma.snapshotImage.count({ where: { snapshot: { userId: user.id } } }),
    ]),
  ]);

  const config = env();
  const [snapshotCount, observationCount, imageCount] = counts;

  return (
    <div>
      <PageHeader title="Settings" description={`Signed in as ${user.email} · ${user.timezone}`} />
      <PageBody>
        <SettingsForm initial={settings} aiMode={isMockAi() ? "mock" : "live"} />

        <div id="kpis">
          <KpiManager kpis={kpis} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
          </CardHeader>
          <CardBody className="flex flex-wrap items-center justify-between gap-4">
            <p className="max-w-md text-[13px] leading-relaxed text-muted">
              The theme is stored in this browser, so each device can differ. System follows your phone or
              laptop&apos;s setting.
            </p>
            <ThemeToggle />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Your data</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <dl className="grid grid-cols-3 gap-4">
              <Stat label="Snapshots" value={snapshotCount} />
              <Stat label="Readings" value={observationCount} />
              <Stat label="Screenshots stored" value={imageCount} />
            </dl>

            <div className="border-t border-[var(--border)] pt-4">
              <p className="text-[13px] leading-relaxed text-muted">
                Victra does not export, so this app does. Everything here is yours and leaves in a format a
                spreadsheet can open.
              </p>
              <ul className="mt-3 space-y-2">
                {EXPORTS.map((item) => (
                  <li key={item.dataset} className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium">{item.label}</p>
                      <p className="text-[11px] text-subtle">{item.description}</p>
                    </div>
                    <span className="flex gap-2">
                      {(["csv", "json"] as const).map((format) => (
                        <a
                          key={format}
                          href={`/api/export?dataset=${item.dataset}&format=${format}`}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border-strong)] px-2.5 text-[12px] font-medium hover:bg-[var(--surface-raised)]"
                        >
                          <Download className="size-3" aria-hidden="true" />
                          {format.toUpperCase()}
                        </a>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="border-t border-[var(--border)] pt-4 text-[12px] leading-relaxed text-muted">
              <p className="font-medium text-[var(--text)]">Retention</p>
              <p className="mt-1">
                Screenshots are stored via the{" "}
                <span className="font-mono">{config.STORAGE_DRIVER}</span> driver and kept until you delete their
                snapshot, which removes the files immediately. Extracted values, corrections and AI usage are kept
                indefinitely so history and extraction quality stay measurable. Database backups are handled by
                the server operator — see <span className="font-mono">docs/OPERATIONS.md</span>.
              </p>
            </div>
          </CardBody>
        </Card>
      </PageBody>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-[11px] tracking-wide text-subtle uppercase">{label}</dt>
      <dd className="mt-1 text-xl font-semibold tnum">{value.toLocaleString()}</dd>
    </div>
  );
}
