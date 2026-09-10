import { History, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DiffView } from "@/components/studio/DiffView";
import { EmptyState, Panel } from "@/components/studio/Panel";
import type { CommitInfo, DocKind } from "@/core/types";
import { useStudio } from "@/lib/studio";

export function HistoryPanel({ kind, name }: { kind: DocKind; name: string }) {
  const { api, mode, applyRestored } = useStudio();
  const [commits, setCommits] = useState<CommitInfo[] | null>(null);
  const [left, setLeft] = useState<string | null>(null);
  const [right, setRight] = useState<string | null>(null);
  const [patch, setPatch] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!api) return;
    try {
      const list = await api.history(kind, name);
      setCommits(list);
      setLeft(list[1]?.oid ?? list[0]?.oid ?? null);
      setRight(null);
      setPatch("");
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [api, kind, name]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!api || !left) return;
    void api
      .diff(kind, name, left, right ?? undefined)
      .then(setPatch)
      .catch((err: Error) => setError(err.message));
  }, [api, kind, left, name, right]);

  const restore = async (oid: string) => {
    if (!api) return;
    try {
      const content = await api.restore(kind, name, oid);
      applyRestored(kind, name, content);
      toast.success(`Restored ${name}`, {
        description:
          mode === "local"
            ? `from commit ${oid.slice(0, 8)}, committed as a new version`
            : `demo snapshot ${oid} (nothing written to disk)`,
      });
      await load();
    } catch (err) {
      toast.error("Restore failed", { description: (err as Error).message });
    }
  };

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(240px,1fr)_1.4fr] gap-2">
      <Panel title={`history · ${name}`} actions={<span className="text-[10px] text-muted-foreground">{commits?.length ?? 0} versions</span>}>
        {error && <p className="p-3 font-mono text-[11px] text-destructive">{error}</p>}
        {commits && commits.length === 0 && (
          <EmptyState title="No versions yet" hint="Every save creates a version. Save this document to start its history." />
        )}
        <ul className="divide-y">
          {(commits ?? []).map((commit, index) => (
            <li key={commit.oid} className="px-2.5 py-2">
              <div className="flex items-start justify-between gap-2">
                <button
                  type="button"
                  onClick={() => (index === 0 ? (setLeft(commit.oid), setRight(null)) : setLeft(commit.oid))}
                  className={`min-w-0 flex-1 text-left ${left === commit.oid ? "text-primary" : "text-foreground"}`}
                >
                  <p className="truncate font-mono text-[11px]">{commit.message}</p>
                  <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                    {commit.oid.slice(0, 8)} · {new Date(commit.date).toLocaleString()}
                    {index === 0 ? " · newest" : ""}
                  </p>
                </button>
                <div className="flex shrink-0 gap-1">
                  <Button size="xs" variant="ghost" onClick={() => setRight(commit.oid)} title="Use as right side of the diff">
                    <History className="size-3" />
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => void restore(commit.oid)} title="Restore this version">
                    <RotateCcw className="size-3" />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel
        title={`diff · ${left ? left.slice(0, 8) : "—"} → ${right ? right.slice(0, 8) : "working file"}`}
        bodyClassName="bg-card"
      >
        {patch.trim() ? (
          <DiffView patch={patch} />
        ) : (
          <EmptyState title="No differences" hint="Pick a version on the left, and optionally a second version to compare against." />
        )}
      </Panel>
    </div>
  );
}
