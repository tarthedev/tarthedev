import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Card({
  children,
  className,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "article";
}) {
  return <Tag className={cn("card", className)}>{children}</Tag>;
}

export function CardHeader({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-start justify-between gap-3 px-5 pt-4 pb-3", className)}>{children}</div>
  );
}

export function CardTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h2 className={cn("text-[13px] font-semibold tracking-wide text-muted uppercase", className)}>
      {children}
    </h2>
  );
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("px-5 pb-5", className)}>{children}</div>;
}

export function CardFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("border-t border-[var(--border)] px-5 py-3 text-sm text-muted", className)}>
      {children}
    </div>
  );
}
