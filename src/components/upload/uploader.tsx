"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ImagePlus, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ErrorNote, InfoNote } from "@/components/ui/empty";
import { cn } from "@/lib/cn";

interface Staged {
  id: string;
  file: File;
  previewUrl: string;
  sizeLabel: string;
}

type Phase = "idle" | "uploading" | "processing" | "done" | "error";

const ACCEPTED = ["image/png", "image/jpeg", "image/webp"];

function sizeLabel(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Screenshot staging area.
 *
 * The whole batch becomes ONE snapshot, because Victra spreads KPI data across
 * several screens. Nothing is sent until the user presses process, so files can
 * be reordered and removed first.
 */
export function Uploader({ maxImages, maxMb }: { maxImages: number; maxMb: number }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [staged, setStaged] = useState<Staged[]>([]);
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [status, setStatus] = useState<string>("");

  // Object URLs are per-file handles; leaking them holds the images in memory.
  useEffect(() => {
    return () => {
      for (const item of staged) URL.revokeObjectURL(item.previewUrl);
    };
    // Intentionally runs only on unmount — per-item cleanup happens in remove().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      setError(null);
      const incoming = Array.from(files);
      const rejected: string[] = [];
      const accepted: Staged[] = [];

      for (const file of incoming) {
        if (!ACCEPTED.includes(file.type)) {
          rejected.push(`${file.name || "file"} is not a PNG, JPEG or WEBP image.`);
          continue;
        }
        if (file.size > maxMb * 1024 * 1024) {
          rejected.push(`${file.name} is ${sizeLabel(file.size)}, over the ${maxMb}MB limit.`);
          continue;
        }
        accepted.push({
          id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
          file,
          previewUrl: URL.createObjectURL(file),
          sizeLabel: sizeLabel(file.size),
        });
      }

      setStaged((current) => {
        const room = maxImages - current.length;
        if (accepted.length > room) {
          rejected.push(`Only ${maxImages} screenshots fit in one snapshot; the rest were not added.`);
          for (const extra of accepted.slice(room)) URL.revokeObjectURL(extra.previewUrl);
        }
        return [...current, ...accepted.slice(0, Math.max(0, room))];
      });

      if (rejected.length > 0) setNotes(rejected);
    },
    [maxImages, maxMb],
  );

  const remove = (id: string) => {
    setStaged((current) => {
      const target = current.find((s) => s.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((s) => s.id !== id);
    });
  };

  const move = (index: number, direction: -1 | 1) => {
    setStaged((current) => {
      const next = [...current];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      const a = next[index];
      const b = next[target];
      if (!a || !b) return current;
      next[index] = b;
      next[target] = a;
      return next;
    });
  };

  async function submit() {
    if (staged.length === 0) return;
    setError(null);
    setNotes([]);
    setPhase("uploading");
    setStatus(`Uploading ${staged.length} screenshot${staged.length === 1 ? "" : "s"}…`);

    try {
      const form = new FormData();
      for (const item of staged) form.append("images", item.file, item.file.name);

      const uploadResponse = await fetch("/api/snapshots", { method: "POST", body: form });
      const uploadBody = await uploadResponse.json().catch(() => ({}));

      if (!uploadResponse.ok) {
        setPhase("error");
        setError(
          uploadBody.detail ? `${uploadBody.error} ${uploadBody.detail}` : (uploadBody.error ?? "Upload failed."),
        );
        return;
      }

      const messages: string[] = [];
      if (uploadBody.duplicatesSkipped > 0) {
        messages.push(
          `${uploadBody.duplicatesSkipped} duplicate screenshot${uploadBody.duplicatesSkipped === 1 ? "" : "s"} skipped — identical images are not sent twice.`,
        );
      }
      for (const item of uploadBody.rejected ?? []) messages.push(item.reason);
      setNotes(messages);

      const snapshotId = uploadBody.snapshot.id as string;
      setPhase("processing");
      setStatus("Reading your screenshots…");

      const processResponse = await fetch(`/api/snapshots/${snapshotId}/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const processBody = await processResponse.json().catch(() => ({}));

      if (!processResponse.ok && processResponse.status !== 422) {
        setPhase("error");
        setError(processBody.error ?? "Extraction failed.");
        // The snapshot exists either way, so the user can still fix it by hand.
        router.push(`/snapshots/${snapshotId}`);
        return;
      }

      setPhase("done");
      for (const item of staged) URL.revokeObjectURL(item.previewUrl);
      setStaged([]);
      router.push(
        processBody.status === "CONFIRMED" ? `/?processed=${snapshotId}` : `/snapshots/${snapshotId}`,
      );
      router.refresh();
    } catch {
      setPhase("error");
      setError("Could not reach the server. Your screenshots were not uploaded — try again.");
    }
  }

  const busy = phase === "uploading" || phase === "processing";

  return (
    <div className="space-y-4">
      {error && <ErrorNote>{error}</ErrorNote>}
      {notes.length > 0 && (
        <InfoNote tone="warning">
          <ul className="space-y-1">
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </InfoNote>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
        }}
        className={cn(
          "rounded-xl border-2 border-dashed p-6 text-center transition-colors sm:p-10",
          dragging
            ? "border-[var(--accent)] bg-[var(--surface-raised)]"
            : "border-[var(--border-strong)] bg-[var(--surface)]",
        )}
      >
        <ImagePlus className="mx-auto size-7 text-[var(--text-subtle)]" aria-hidden="true" />
        <p className="mt-3 text-sm font-medium">Drop your KPI screenshots here</p>
        <p className="mt-1 text-[13px] text-muted">
          Every screenshot in this batch becomes one snapshot. PNG, JPEG or WEBP, up to {maxImages} images.
        </p>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED.join(",")}
          multiple
          className="sr-only-focusable"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="secondary"
          className="mt-4"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          Choose screenshots
        </Button>
      </div>

      {staged.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-[13px] text-muted tnum">
              {staged.length} screenshot{staged.length === 1 ? "" : "s"} staged
            </p>
            <button
              type="button"
              onClick={() => {
                for (const item of staged) URL.revokeObjectURL(item.previewUrl);
                setStaged([]);
              }}
              disabled={busy}
              className="text-[13px] text-muted underline underline-offset-2 hover:text-[var(--text)] disabled:opacity-50"
            >
              Clear all
            </button>
          </div>

          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {staged.map((item, index) => (
              <li key={item.id} className="card overflow-hidden">
                <div className="relative aspect-[3/5] bg-[var(--surface-sunken)]">
                  {/* Local object URL, so next/image would add no value here. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.previewUrl}
                    alt={`Screenshot ${index + 1}: ${item.file.name}`}
                    className="size-full object-cover object-top"
                  />
                  <span className="absolute top-2 left-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white tnum">
                    {index + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => remove(item.id)}
                    disabled={busy}
                    aria-label={`Remove screenshot ${index + 1}`}
                    className="absolute top-1.5 right-1.5 inline-flex size-7 items-center justify-center rounded-md bg-black/70 text-white hover:bg-black/85 disabled:opacity-50"
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                </div>
                <div className="flex items-center justify-between gap-1 px-2 py-1.5">
                  <span className="truncate text-[11px] text-subtle tnum">{item.sizeLabel}</span>
                  <span className="flex">
                    <button
                      type="button"
                      onClick={() => move(index, -1)}
                      disabled={busy || index === 0}
                      aria-label={`Move screenshot ${index + 1} earlier`}
                      className="inline-flex size-7 items-center justify-center rounded text-[var(--text-subtle)] hover:text-[var(--text)] disabled:opacity-30"
                    >
                      <ArrowUp className="size-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(index, 1)}
                      disabled={busy || index === staged.length - 1}
                      aria-label={`Move screenshot ${index + 1} later`}
                      className="inline-flex size-7 items-center justify-center rounded text-[var(--text-subtle)] hover:text-[var(--text)] disabled:opacity-30"
                    >
                      <ArrowDown className="size-3.5" aria-hidden="true" />
                    </button>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="sticky bottom-20 z-10 md:bottom-4">
        <Button
          type="button"
          variant="primary"
          size="lg"
          onClick={submit}
          loading={busy}
          disabled={staged.length === 0}
          className="w-full shadow-lg"
        >
          {busy ? status : `Process KPI snapshot${staged.length > 0 ? ` (${staged.length})` : ""}`}
        </Button>
        {busy && (
          <p aria-live="polite" className="mt-2 flex items-center justify-center gap-2 text-[13px] text-muted">
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            {phase === "processing"
              ? "This usually takes 10–30 seconds depending on how many screens you uploaded."
              : "Uploading…"}
          </p>
        )}
      </div>
    </div>
  );
}
