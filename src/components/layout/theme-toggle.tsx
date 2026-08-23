"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

type Theme = "light" | "dark" | "system";
const STORAGE_KEY = "kpi-theme";

function apply(theme: Theme): void {
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>("system");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? "system";
    setTheme(stored);
    setMounted(true);

    // Follow the OS while the user has chosen "system".
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if ((localStorage.getItem(STORAGE_KEY) as Theme | null) === "system") apply("system");
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const choose = (next: Theme) => {
    setTheme(next);
    localStorage.setItem(STORAGE_KEY, next);
    apply(next);
  };

  const options: { value: Theme; label: string; Icon: typeof Sun }[] = [
    { value: "light", label: "Light", Icon: Sun },
    { value: "dark", label: "Dark", Icon: Moon },
    { value: "system", label: "System", Icon: Monitor },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={cn("inline-flex rounded-lg border border-[var(--border)] p-0.5", className)}
    >
      {options.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={mounted ? theme === value : undefined}
          aria-label={label}
          title={label}
          onClick={() => choose(value)}
          className={cn(
            "inline-flex size-8 items-center justify-center rounded-md transition-colors",
            mounted && theme === value
              ? "bg-[var(--surface-raised)] text-[var(--text)]"
              : "text-[var(--text-subtle)] hover:text-[var(--text)]",
          )}
        >
          <Icon className="size-4" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
