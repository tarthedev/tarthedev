"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/cn";

export function SignOutButton({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const signOut = async () => {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.replace("/login");
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={busy}
      aria-label="Sign out"
      title="Sign out"
      className={cn(
        "inline-flex items-center gap-2 rounded-lg text-[var(--text-subtle)] transition-colors hover:text-[var(--text)] disabled:opacity-50",
        compact ? "size-8 justify-center" : "h-8 px-2 text-[13px]",
      )}
    >
      <LogOut className="size-4" aria-hidden="true" />
      {!compact && <span>Sign out</span>}
    </button>
  );
}
