import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="border-b border-[var(--border)] bg-[var(--surface)] px-4 py-5 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
          {description && <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export function PageBody({ children }: { children: ReactNode }) {
  return <div className="space-y-5 px-4 py-6 sm:px-6 lg:px-8">{children}</div>;
}
