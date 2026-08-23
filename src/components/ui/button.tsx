"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-[var(--accent)] text-[var(--accent-text)] hover:opacity-90 disabled:opacity-40 border border-transparent",
  secondary:
    "bg-[var(--surface)] text-[var(--text)] border border-[var(--border-strong)] hover:bg-[var(--surface-raised)] disabled:opacity-40",
  ghost:
    "bg-transparent text-[var(--text-muted)] hover:bg-[var(--surface-raised)] hover:text-[var(--text)] border border-transparent",
  danger:
    "bg-transparent text-[var(--negative)] border border-[var(--negative)] hover:bg-[var(--negative-bg)] disabled:opacity-40",
};

const SIZES: Record<Size, string> = {
  // 44px minimum touch target on mobile — this is used one-handed in a store.
  sm: "h-9 px-3 text-[13px] rounded-lg",
  md: "h-11 px-4 text-sm rounded-lg",
  lg: "h-12 px-5 text-[15px] rounded-xl",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  children: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex items-center justify-center gap-2 font-medium transition-[opacity,background-color] select-none",
        "disabled:cursor-not-allowed",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
    >
      {loading && (
        <span
          aria-hidden="true"
          className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {children}
    </button>
  );
}
