import type { PaceStatus } from "@/lib/kpi/pace";
import { STATUS_LABEL } from "@/lib/kpi/pace";
import { cn } from "@/lib/cn";

/**
 * Status is never communicated by colour alone — every badge carries its label,
 * and the dot is decorative. That keeps the dashboard readable for colour-blind
 * users and in bright store lighting.
 */
const STYLES: Record<PaceStatus, { text: string; bg: string; dot: string }> = {
  COMPLETE: { text: "text-[var(--positive)]", bg: "bg-[var(--positive-bg)]", dot: "bg-[var(--positive)]" },
  AHEAD: { text: "text-[var(--positive)]", bg: "bg-[var(--positive-bg)]", dot: "bg-[var(--positive)]" },
  ON_TRACK: { text: "text-[var(--positive)]", bg: "bg-[var(--positive-bg)]", dot: "bg-[var(--positive)]" },
  AT_RISK: { text: "text-[var(--warning)]", bg: "bg-[var(--warning-bg)]", dot: "bg-[var(--warning)]" },
  BEHIND: { text: "text-[var(--negative)]", bg: "bg-[var(--negative-bg)]", dot: "bg-[var(--negative)]" },
  MISSED: { text: "text-[var(--negative)]", bg: "bg-[var(--negative-bg)]", dot: "bg-[var(--negative)]" },
  NO_GOAL: { text: "text-[var(--neutral)]", bg: "bg-[var(--neutral-bg)]", dot: "bg-[var(--neutral)]" },
};

export function StatusBadge({
  status,
  className,
  size = "md",
}: {
  status: PaceStatus;
  className?: string;
  size?: "sm" | "md";
}) {
  const style = STYLES[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-medium whitespace-nowrap",
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs",
        style.bg,
        style.text,
        className,
      )}
    >
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", style.dot)} />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function statusTextClass(status: PaceStatus): string {
  return STYLES[status].text;
}

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "positive" | "negative" | "warning" | "info";
  className?: string;
}) {
  const tones = {
    neutral: "bg-[var(--neutral-bg)] text-[var(--neutral)]",
    positive: "bg-[var(--positive-bg)] text-[var(--positive)]",
    negative: "bg-[var(--negative-bg)] text-[var(--negative)]",
    warning: "bg-[var(--warning-bg)] text-[var(--warning)]",
    info: "bg-[var(--info-bg)] text-[var(--info)]",
  } as const;

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
