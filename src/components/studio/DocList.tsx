import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { EmptyState, Panel } from "@/components/studio/Panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { StoreDoc } from "@/core/types";
import { cn } from "@/lib/utils";

export function DocList({
  title,
  docs,
  selected,
  onSelect,
  onCreate,
  onDelete,
  isDirty,
  emptyHint,
  newLabel = "new-name",
}: {
  title: string;
  docs: StoreDoc[];
  selected: string | null;
  onSelect: (name: string) => void;
  onCreate?: (name: string) => void;
  onDelete?: (name: string) => void;
  isDirty?: (name: string) => boolean;
  emptyHint?: string;
  newLabel?: string;
}) {
  const [adding, setAdding] = useState(false);
  const [draftName, setDraftName] = useState("");

  const submit = () => {
    const name = draftName.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) return;
    onCreate?.(name);
    setDraftName("");
    setAdding(false);
  };

  return (
    <Panel
      title={title}
      actions={
        onCreate && (
          <Button size="xs" variant="ghost" onClick={() => setAdding((v) => !v)} title="New document">
            <Plus className="size-3" />
          </Button>
        )
      }
    >
      {adding && (
        <div className="flex gap-1 border-b p-2">
          <Input
            autoFocus
            value={draftName}
            placeholder={newLabel}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") setAdding(false);
            }}
            className="h-7 font-mono text-xs"
          />
          <Button size="xs" onClick={submit}>
            Add
          </Button>
        </div>
      )}
      {docs.length === 0 ? (
        <EmptyState title="Nothing here yet" {...(emptyHint ? { hint: emptyHint } : {})} />
      ) : (
        <ul className="divide-y">
          {docs.map((doc) => (
            <li key={doc.name} className="group flex items-center">
              <button
                type="button"
                onClick={() => onSelect(doc.name)}
                className={cn(
                  "min-w-0 flex-1 truncate px-2.5 py-1.5 text-left font-mono text-[11px] transition-colors hover:bg-muted/60",
                  selected === doc.name && "bg-accent text-accent-foreground",
                )}
              >
                {doc.name}
                {isDirty?.(doc.name) && <span className="ml-1 text-primary">•</span>}
              </button>
              {onDelete && (
                <Button
                  size="xs"
                  variant="ghost"
                  className="mr-1 opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={() => onDelete(doc.name)}
                  title={`Delete ${doc.name}`}
                >
                  <Trash2 className="size-3" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
