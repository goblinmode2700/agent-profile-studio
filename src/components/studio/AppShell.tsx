import { Link } from "@tanstack/react-router";
import {
  Boxes,
  FileCode2,
  FlaskConical,
  FolderKanban,
  GitBranch,
  Layers,
  Puzzle,
} from "lucide-react";
import type { ReactNode } from "react";

import { useStudio } from "@/lib/studio";
import { cn } from "@/lib/utils";
import { CatalogTree } from "@/components/studio/CatalogTree";

const NAV = [
  { to: "/", label: "Profiles", icon: Layers },
  { to: "/partials", label: "Partials", icon: Puzzle },
  { to: "/fragments", label: "Fragments", icon: Boxes },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/playground", label: "Playground", icon: FlaskConical },
  { to: "/history", label: "History", icon: GitBranch },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const { mode, storePath, connectionNote } = useStudio();

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      <aside className="flex w-52 shrink-0 flex-col border-r bg-sidebar">
        <div className="flex h-11 items-center gap-2 border-b px-3">
          <FileCode2 className="size-4 text-primary" />
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold tracking-tight">Agent Profile Studio</p>
          </div>
        </div>
        <nav className="flex flex-col gap-0.5 p-2">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: item.to === "/" }}
              activeProps={{ className: "bg-accent text-accent-foreground" }}
              className="flex items-center gap-2 rounded px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            >
              <item.icon className="size-3.5" />
              {item.label}
            </Link>
          ))}
        </nav>
        <CatalogTree />
        <div className="mt-auto space-y-1.5 border-t p-2.5">
          <p
            className={cn(
              "inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider",
              mode === "local" ? "bg-primary/15 text-primary" : "bg-accent text-accent-foreground",
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                mode === "local" ? "bg-primary" : "bg-accent-foreground",
              )}
            />
            {mode === "local" ? "local store" : mode === "demo" ? "demo mode" : "connecting"}
          </p>
          <p className="break-all font-mono text-[10px] leading-relaxed text-muted-foreground">
            {storePath}
          </p>
          {mode === "demo" && (
            <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
              Nothing is read from or written to disk. Run{" "}
              <span className="text-foreground">npm run studio</span> locally for the real
              git-backed store. ({connectionNote})
            </p>
          )}
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b px-3">
      <div className="min-w-0">
        <h1 className="truncate text-xs font-semibold tracking-tight">{title}</h1>
        {subtitle && (
          <p className="truncate font-mono text-[10px] text-muted-foreground">{subtitle}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
    </header>
  );
}
