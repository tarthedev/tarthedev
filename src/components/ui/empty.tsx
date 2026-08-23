import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Empty states explain the workflow rather than showing a grid of zeroes. An
 * empty chart teaches nothing; a sentence about what to do next does.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: { label: string; href: string };
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-14 text-center", className)}>
      {icon && <div className="mb-4 text-[var(--text-subtle)]">{icon}</div>}
      <h3 className="text-base font-semibold text-[var(--text)]">{title}</h3>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-muted">{description}</p>
      {action && (
        <Link
          href={action.href}
          className="mt-5 inline-flex h-11 items-center rounded-lg bg-[var(--accent)] px-4 text-sm font-medium text-[var(--accent-text)] hover:opacity-90"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}

export function ErrorNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      role="alert"
      className={cn(
        "rounded-lg border border-[var(--negative)] bg-[var(--negative-bg)] px-4 py-3 text-sm text-[var(--negative)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function InfoNote({
  children,
  tone = "info",
  className,
}: {
  children: ReactNode;
  tone?: "info" | "warning";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-3 text-sm",
        tone === "warning"
          ? "border-[var(--warning)] bg-[var(--warning-bg)] text-[var(--warning)]"
          : "border-[var(--border-strong)] bg-[var(--surface-raised)] text-muted",
        className,
      )}
    >
      {children}
    </div>
  );
}
