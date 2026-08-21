"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Brain,
  Gauge,
  History,
  Images,
  MessageSquare,
  Settings,
  Target,
  Upload,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/cn";

export interface NavItem {
  href: string;
  label: string;
  Icon: typeof Gauge;
  /** Shown in the phone tab bar as well as the sidebar. */
  primary?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Command Center", Icon: Gauge, primary: true },
  { href: "/upload", label: "Upload", Icon: Upload, primary: true },
  { href: "/coach", label: "AI Coach", Icon: Brain, primary: true },
  { href: "/scorecard", label: "Scorecard", Icon: BarChart3, primary: true },
  { href: "/goals", label: "Goals", Icon: Target },
  { href: "/history", label: "History", Icon: History },
  { href: "/snapshots", label: "Snapshots", Icon: Images },
  { href: "/chat", label: "Ask", Icon: MessageSquare },
  { href: "/usage", label: "AI Cost", Icon: Wallet },
  { href: "/settings", label: "Settings", Icon: Settings, primary: true },
];

function useIsActive(href: string): boolean {
  const pathname = usePathname();
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({ item, badge }: { item: NavItem; badge?: number }) {
  const active = useIsActive(item.href);
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
        active
          ? "bg-[var(--surface-raised)] font-medium text-[var(--text)]"
          : "text-muted hover:bg-[var(--surface-raised)] hover:text-[var(--text)]",
      )}
    >
      <item.Icon className="size-4 shrink-0" aria-hidden="true" />
      <span className="truncate">{item.label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="ml-auto rounded-full bg-[var(--warning-bg)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--warning)]">
          {badge}
        </span>
      )}
    </Link>
  );
}

export function Sidebar({ pendingReviewCount = 0 }: { pendingReviewCount?: number }) {
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5 px-3">
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.href}
          item={item}
          badge={item.href === "/snapshots" ? pendingReviewCount : undefined}
        />
      ))}
    </nav>
  );
}

/** Phone tab bar. Five destinations is the most a thumb can reliably hit. */
export function MobileNav({ pendingReviewCount = 0 }: { pendingReviewCount?: number }) {
  const items = NAV_ITEMS.filter((i) => i.primary);
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border)] bg-[var(--surface)]/95 backdrop-blur md:hidden"
    >
      <ul className="flex">
        {items.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-14 flex-col items-center justify-center gap-1 text-[10px] font-medium",
                  active ? "text-[var(--text)]" : "text-[var(--text-subtle)]",
                )}
              >
                <item.Icon className="size-5" aria-hidden="true" />
                <span>{item.label === "Command Center" ? "Home" : item.label}</span>
                {item.href === "/upload" && pendingReviewCount > 0 && (
                  <span className="absolute top-2 right-1/4 size-2 rounded-full bg-[var(--warning)]" />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
