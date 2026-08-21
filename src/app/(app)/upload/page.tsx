import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";

import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Uploader } from "@/components/upload/uploader";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/guard";
import { env, isMockAi } from "@/lib/env";
import { getSettings } from "@/lib/settings";
import { InfoNote } from "@/components/ui/empty";

export const metadata: Metadata = { title: "Upload" };
export const dynamic = "force-dynamic";

export default async function UploadPage() {
  const user = await requireUser();
  const settings = await getSettings(user.id);
  const config = env();

  return (
    <div>
      <PageHeader
        title="Upload KPI snapshot"
        description="Screenshot every Victra screen that shows your numbers, then upload them together. They are read as one snapshot, so KPIs spread across several screens end up in the same record."
      />
      <PageBody>
        {isMockAi() && (
          <InfoNote tone="warning">
            Development mode is on (<code className="font-mono text-[12px]">AI_DEV_MODE</code>), so uploads are
            processed by the mock provider and the extracted values are synthetic. Set an Anthropic API key and
            turn dev mode off for real extraction.
          </InfoNote>
        )}

        <Uploader maxImages={config.MAX_IMAGES_PER_SNAPSHOT} maxMb={config.MAX_UPLOAD_MB} />

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>How this works</CardTitle>
            </CardHeader>
            <CardBody>
              <ol className="space-y-2.5 text-[13px] leading-relaxed text-muted">
                {[
                  "Your screenshots are resized and stripped of metadata, then read by the vision model.",
                  "Each value comes back with a confidence score and the screenshot it came from.",
                  `Anything below ${Math.round(settings.confidenceThreshold * 100)}% confidence, any conflict between screens, and any unfamiliar KPI is held for your review.`,
                  "Confirmed values land in Postgres, and every calculation on the dashboard is done in application code from there.",
                ].map((step, index) => (
                  <li key={step} className="flex gap-3">
                    <span className="mt-px inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--surface-raised)] text-[11px] font-medium text-[var(--text)] tnum">
                      {index + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Your screenshots stay private</CardTitle>
              <ShieldCheck className="size-4 text-[var(--text-subtle)]" aria-hidden="true" />
            </CardHeader>
            <CardBody>
              <ul className="space-y-2 text-[13px] leading-relaxed text-muted">
                <li>Stored outside the web root and served only to your signed-in session.</li>
                <li>Never given a public URL, and marked no-index for crawlers.</li>
                <li>Sent to Anthropic only to read the values, and not used to train models.</li>
                <li>Deleting a snapshot deletes its screenshots from storage immediately.</li>
                <li className="tnum">
                  Storage driver: <span className="font-mono text-[12px]">{config.STORAGE_DRIVER}</span>
                </li>
              </ul>
            </CardBody>
          </Card>
        </div>
      </PageBody>
    </div>
  );
}
