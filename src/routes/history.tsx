import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { PageHeader } from "@/components/studio/AppShell";
import { DocList } from "@/components/studio/DocList";
import { HistoryPanel } from "@/components/studio/HistoryPanel";
import { EmptyState } from "@/components/studio/Panel";
import type { DocKind } from "@/core/types";
import { useStudio } from "@/lib/studio";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [
      { title: "History — Agent Profile Studio" },
      {
        name: "description",
        content:
          "Every save is a commit: browse the version history of any profile, partial or fragment, diff any two versions, and restore an earlier one.",
      },
      { property: "og:title", content: "History — Agent Profile Studio" },
      {
        property: "og:description",
        content: "Browse commit history, diff any two versions and restore an earlier one.",
      },
    ],
  }),
  component: HistoryPage,
});

const KINDS: Array<{ kind: DocKind; label: string }> = [
  { kind: "profile", label: "Profiles" },
  { kind: "partial", label: "Partials" },
  { kind: "fragment", label: "Fragments" },
  { kind: "helper", label: "Helpers" },
  { kind: "targets", label: "targets.yaml" },
];

function HistoryPage() {
  const { list, mode, storePath } = useStudio();
  const [kind, setKind] = useState<DocKind>("profile");
  const [name, setName] = useState<string | null>(null);
  const docs = list(kind);

  useEffect(() => {
    setName(docs[0]?.name ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, docs.length]);

  return (
    <>
      <PageHeader
        title="History"
        subtitle={
          mode === "local"
            ? `git repository at ${storePath}`
            : "demo mode · snapshots in this browser, not git commits"
        }
      />
      <div className="grid min-h-0 flex-1 grid-cols-[13rem_1fr] gap-2 overflow-hidden p-2">
        <div className="flex min-h-0 flex-col gap-2">
          <div className="flex flex-wrap gap-1">
            {KINDS.map((item) => (
              <button
                key={item.kind}
                type="button"
                onClick={() => setKind(item.kind)}
                className={cn(
                  "rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors",
                  kind === item.kind
                    ? "border-primary/40 bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-muted/60",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
          <DocList
            title="documents"
            docs={docs}
            selected={name}
            onSelect={setName}
            emptyHint="Nothing of this kind in the store yet."
          />
        </div>
        {name ? (
          <div className="flex min-h-0 flex-col">
            <HistoryPanel key={`${kind}:${name}`} kind={kind} name={name} />
          </div>
        ) : (
          <EmptyState title="No document selected" hint="Pick a document to see its versions." />
        )}
      </div>
    </>
  );
}
