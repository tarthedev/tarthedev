import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/layout/theme-toggle";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="flex justify-end p-4">
        <ThemeToggle />
      </div>
      <main id="main" className="flex flex-1 items-start justify-center px-4 pt-6 pb-16 sm:items-center sm:pt-0">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
