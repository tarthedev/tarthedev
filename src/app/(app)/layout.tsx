import Link from "next/link";
import type { ReactNode } from "react";

import { MobileNav, Sidebar } from "@/components/layout/nav";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { SignOutButton } from "@/components/layout/sign-out";
import { requireUser } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const pendingReviewCount = await prisma.snapshot.count({
    where: { userId: user.id, status: "NEEDS_REVIEW" },
  });

  return (
    <div className="flex min-h-dvh">
      {/* Desktop rail */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)] md:flex">
        <div className="px-5 py-5">
          <Link href="/" className="block">
            <p className="text-[15px] leading-tight font-semibold tracking-tight">KPI Command Center</p>
            <p className="mt-0.5 text-[11px] text-subtle">{user.email}</p>
          </Link>
        </div>

        <div className="flex-1 overflow-y-auto pb-4">
          <Sidebar pendingReviewCount={pendingReviewCount} />
        </div>

        <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-3">
          <ThemeToggle />
          <SignOutButton />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Phone header */}
        <header className="safe-top sticky top-0 z-30 flex h-14 items-center justify-between border-b border-[var(--border)] bg-[var(--surface)]/95 px-4 backdrop-blur md:hidden">
          <Link href="/" className="text-sm font-semibold tracking-tight">
            KPI Command Center
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <SignOutButton compact />
          </div>
        </header>

        <main id="main" className="min-w-0 flex-1 pb-20 md:pb-0">
          {children}
        </main>

        <MobileNav pendingReviewCount={pendingReviewCount} />
      </div>
    </div>
  );
}
