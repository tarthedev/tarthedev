"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RefreshCw, Trash2, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ErrorNote } from "@/components/ui/empty";

/** Reprocess, escalate, or delete. Deleting also removes the stored images. */
export function SnapshotActions({ snapshotId }: { snapshotId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function reprocess(forceEscalation: boolean) {
    setBusy(forceEscalation ? "escalate" : "reprocess");
    setError(null);
    try {
      const response = await fetch(`/api/snapshots/${snapshotId}/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forceEscalation }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok && response.status !== 422) {
        setError(body.error ?? "Could not reprocess this snapshot.");
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("delete");
    setError(null);
    try {
      const response = await fetch(`/api/snapshots/${snapshotId}`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? "Could not delete this snapshot.");
        return;
      }
      router.push("/snapshots");
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" loading={busy === "reprocess"} onClick={() => reprocess(false)}>
          <RefreshCw className="size-3.5" aria-hidden="true" />
          Re-extract
        </Button>
        <Button size="sm" variant="secondary" loading={busy === "escalate"} onClick={() => reprocess(true)}>
          <Zap className="size-3.5" aria-hidden="true" />
          Retry with deep model
        </Button>

        {confirmingDelete ? (
          <span className="inline-flex items-center gap-2">
            <Button size="sm" variant="danger" loading={busy === "delete"} onClick={remove}>
              Delete permanently
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(false)}>
              Cancel
            </Button>
          </span>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(true)}>
            <Trash2 className="size-3.5" aria-hidden="true" />
            Delete
          </Button>
        )}
      </div>
      {confirmingDelete && (
        <p className="text-[12px] text-muted">
          This removes the snapshot, its extracted values, and its screenshots from storage. It cannot be undone.
        </p>
      )}
    </div>
  );
}
