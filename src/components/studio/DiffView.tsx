import { cn } from "@/lib/utils";

/** Renders a unified diff produced by jsdiff. */
export function DiffView({ patch, className }: { patch: string; className?: string }) {
  const lines = patch.split("\n");
  return (
    <pre className={cn("overflow-auto bg-card p-2 font-mono text-[11px] leading-relaxed", className)}>
      {lines.map((line, index) => {
        const kind = line.startsWith("+++") || line.startsWith("---")
          ? "meta"
          : line.startsWith("@@")
            ? "hunk"
            : line.startsWith("+")
              ? "add"
              : line.startsWith("-")
                ? "del"
                : "ctx";
        return (
          <div
            key={index}
            className={cn(
              "whitespace-pre-wrap px-1",
              kind === "add" && "bg-primary/15 text-primary",
              kind === "del" && "bg-destructive/15 text-destructive",
              kind === "hunk" && "text-accent-foreground",
              kind === "meta" && "text-muted-foreground",
              kind === "ctx" && "text-foreground/80",
            )}
          >
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}
