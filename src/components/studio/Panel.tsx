import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function Panel({
  title,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("flex min-h-0 flex-col overflow-hidden rounded-md border bg-card", className)}>
      {(title || actions) && (
        <header className="flex h-8 shrink-0 items-center justify-between gap-2 border-b bg-muted/40 px-2.5">
          <span className="truncate font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            {title}
          </span>
          <div className="flex shrink-0 items-center gap-1">{actions}</div>
        </header>
      )}
      <div className={cn("min-h-0 flex-1 overflow-auto", bodyClassName)}>{children}</div>
    </section>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {hint && <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">{hint}</p>}
      {action}
    </div>
  );
}
