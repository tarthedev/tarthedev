import { useState } from "react";
import { Alert, Badge, Button, Card, cx, PageHeader } from "../../components/ui";
import { formatDuration, groupThousands } from "../../lib/format";
import { clockTime, fixesPerMinute, formatLogLine, logText } from "./gpsLog";
import { type PermissionLabel, useGpsTest, type WakeLockLabel } from "./useGpsTest";

const PERMISSION_WORDS: Record<PermissionLabel, string> = {
  granted: "Allowed",
  prompt: "Will ask",
  denied: "Denied",
  unknown: "Unknown",
};

const WAKE_LOCK_WORDS: Record<WakeLockLabel, string> = {
  on: "On",
  off: "Off",
  unsupported: "Not available",
  failed: "Refused",
};

/**
 * A fix older than this is called stale on this page. Stricter than the board
 * (docs/03: the customer's live dot needs one under about 2 minutes) because
 * pings are meant to go every 10 to 15 seconds; a 30-second gap is worth a note.
 */
const STALE_AFTER_S = 30;
/** Log lines shown on screen; "Copy log" copies all of them. */
const SHOWN_LINES = 200;

/**
 * The month-1 single-iPad GPS test (docs/04, outside paperwork; docs/03,
 * Truck GPS). Run it from the home-screen app, drive around, lock the screen,
 * switch apps, then copy the log.
 */
export function GpsTestPage() {
  const gps = useGpsTest();
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null);

  const sinceFix = gps.fix ? Math.max(0, (gps.now - gps.fix.receivedAt) / 1000) : null;
  const stale = sinceFix !== null && sinceFix > STALE_AFTER_S;
  const perMinute = gps.startedAt
    ? fixesPerMinute(gps.fixTimes, gps.startedAt, gps.now)
    : { lastMinute: 0, minutes: [] };

  async function copyLog() {
    const text = logText(
      gps.log,
      {
        standalone: gps.standalone,
        permission: PERMISSION_WORDS[gps.permission],
        wakeLock: WAKE_LOCK_WORDS[gps.wakeLock],
        userAgent: navigator.userAgent,
      },
      Date.now(),
    );
    setCopied((await copyText(text)) ? "yes" : "failed");
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="GPS test"
        subtitle="Checks this iPad's location for the dispatch map. Nothing is sent anywhere."
      />

      {gps.needsTap ? (
        <button
          type="button"
          onClick={gps.resume}
          className="block min-h-20 w-full rounded-2xl bg-orange px-4 text-2xl font-bold text-navy"
        >
          Tap to resume GPS
        </button>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Status label="Test" value={gps.running ? "Running" : "Stopped"} good={gps.running} />
        <Status
          label="Home-screen app"
          value={gps.standalone ? "Yes" : "No, in Safari"}
          good={gps.standalone}
        />
        <Status
          label="Location permission"
          value={PERMISSION_WORDS[gps.permission]}
          good={gps.permission === "granted"}
          bad={gps.permission === "denied"}
        />
        <Status
          label="Screen kept on"
          value={WAKE_LOCK_WORDS[gps.wakeLock]}
          good={gps.wakeLock === "on"}
          bad={gps.wakeLock === "failed"}
        />
      </div>

      {gps.running ? (
        <Button variant="danger" className="min-h-16 w-full text-xl" onClick={gps.stop}>
          Stop
        </Button>
      ) : (
        <Button className="min-h-16 w-full text-xl" onClick={gps.start}>
          Start
        </Button>
      )}

      {gps.permission === "denied" ? (
        <Alert tone="error" title="Location is turned off for this app">
          On the iPad: Settings › Privacy &amp; Security › Location Services on, and Safari Websites
          set to While Using with Precise Location on. Also Settings › Apps › Safari › Location:
          Allow. Then come back and tap Start.
        </Alert>
      ) : null}
      {gps.lastError && gps.permission !== "denied" ? (
        <Alert tone="warning">{gps.lastError}</Alert>
      ) : null}

      <Card title="Latest fix">
        {gps.fix ? (
          <div className="space-y-3">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Reading label="Latitude" value={gps.fix.latitude.toFixed(6)} />
              <Reading label="Longitude" value={gps.fix.longitude.toFixed(6)} />
              <Reading
                label="Accuracy"
                value={`±${groupThousands(Math.round(gps.fix.accuracy))} m`}
              />
              <Reading
                label="Speed"
                value={gps.fix.speed === null ? "—" : `${Math.round(gps.fix.speed * 3.6)} km/h`}
              />
              <Reading
                label="Heading"
                value={gps.fix.heading === null ? "—" : `${Math.round(gps.fix.heading)}°`}
              />
              <Reading label="Fix time" value={clockTime(gps.fix.takenAt)} />
            </dl>
            <p className={cx("text-xl font-semibold", stale ? "text-bad" : "text-ok")}>
              Last fix {formatDuration(sinceFix ?? 0)} ago{stale ? " (stale)" : ""}
            </p>
          </div>
        ) : (
          <p className="text-lg text-muted">
            {gps.running ? "Waiting for the first fix…" : "Tap Start to begin."}
          </p>
        )}
      </Card>

      <Card title="Fixes per minute">
        <p className="text-xl">
          Last 60 seconds: <strong className="tabular">{perMinute.lastMinute}</strong> · Since
          Start: <strong className="tabular">{groupThousands(gps.fixTimes.length)}</strong>
        </p>
        {perMinute.minutes.length > 0 ? (
          <ol className="mt-3 flex flex-wrap gap-2" aria-label="Fixes in each minute since Start">
            {perMinute.minutes
              .slice(-30)
              .reverse()
              .map((m) => (
                <li
                  key={m.minute}
                  className={cx(
                    "rounded-lg border-2 px-3 py-1 text-base",
                    m.count === 0 ? "border-bad text-bad" : "border-line",
                  )}
                >
                  <span className="text-muted">{clockTime(m.startsAt).slice(0, 5)}</span>{" "}
                  <strong className="tabular">{m.count}</strong>
                </li>
              ))}
          </ol>
        ) : null}
      </Card>

      <Card
        title={`Log (${groupThousands(gps.log.length)})`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={copyLog}>
              Copy log
            </Button>
            <Button variant="ghost" onClick={gps.clearLog}>
              Clear log
            </Button>
          </div>
        }
      >
        {copied === "yes" ? (
          <p role="status" className="mb-2 font-semibold text-ok">
            Copied. Paste it into a text or email to the office.
          </p>
        ) : copied === "failed" ? (
          <p role="alert" className="mb-2 font-semibold text-bad">
            Couldn't copy. Select the log below and copy it by hand.
          </p>
        ) : null}
        <p className="mb-2 text-base text-muted">
          Kept on this iPad only, newest first. Visible: {gps.visible ? "yes" : "no"}.
        </p>
        <pre className="max-h-[28rem] overflow-auto rounded-xl bg-navy p-3 font-mono text-sm leading-relaxed whitespace-pre-wrap text-paper">
          {gps.log.length === 0
            ? "Nothing logged yet."
            : gps.log.slice(-SHOWN_LINES).reverse().map(formatLogLine).join("\n")}
        </pre>
      </Card>
    </div>
  );
}

function Status({
  label,
  value,
  good = false,
  bad = false,
}: {
  label: string;
  value: string;
  good?: boolean;
  bad?: boolean;
}) {
  return (
    <div
      className={cx(
        "rounded-xl border-2 bg-white px-3 py-2",
        bad ? "border-bad" : good ? "border-ok" : "border-line",
      )}
    >
      <p className="text-sm font-semibold tracking-wide text-muted uppercase">{label}</p>
      <p className="flex items-center gap-2 text-lg font-bold text-navy">
        {value}
        {bad ? <Badge tone="bad">Check</Badge> : null}
      </p>
    </div>
  );
}

function Reading({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-sm font-semibold tracking-wide text-muted uppercase">{label}</dt>
      <dd className="tabular text-xl font-semibold">{value}</dd>
    </div>
  );
}

/** Clipboard API where allowed, else the old select-and-copy. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the old way.
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}
