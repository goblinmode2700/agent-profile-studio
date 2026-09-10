import { Download, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { DiffView } from "@/components/studio/DiffView";
import { EmptyState, Panel } from "@/components/studio/Panel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { InstallPlanEntry } from "@/core/types";
import type { InstallPlan } from "@/lib/api";
import { useStudio } from "@/lib/studio";

const STATUS_STYLE: Record<InstallPlanEntry["status"], string> = {
  new: "text-primary",
  unchanged: "text-muted-foreground",
  changed: "text-accent-foreground",
  error: "text-destructive",
};

export function InstallPanel({ role, dirty }: { role: string; dirty: boolean }) {
  const { api, mode } = useStudio();
  const [plan, setPlan] = useState<InstallPlan | null>(null);
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const preview = useCallback(async () => {
    if (!api) return;
    setBusy(true);
    try {
      const next = await api.installPreview(role);
      setPlan(next);
      setChosen(
        Object.fromEntries(next.entries.map((e) => [e.target, e.status === "new" || e.status === "changed"])),
      );
      setError(null);
    } catch (err) {
      setPlan(null);
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [api, role]);

  useEffect(() => {
    void preview();
  }, [preview]);

  const write = async () => {
    if (!api || !plan) return;
    // Confirmation is bound to the destination and to the exact bytes previewed, as well as
    // to the bytes already on disk, so any edit in between forces a fresh diff.
    const entries = plan.entries
      .filter((e) => chosen[e.target] && e.status !== "error")
      .map((e) => ({
        target: e.target,
        expectedHash: e.existingHash ?? null,
        ...(e.proposedHash ? { proposedHash: e.proposedHash } : {}),
        ...(e.filePath ? { filePath: e.filePath } : {}),
      }));
    if (entries.length === 0) return;

    setBusy(true);
    try {
      const result = await api.installApply(role, entries);
      if (result.conflicts.length) {
        toast.error("Nothing was overwritten", {
          description: result.conflicts[0]?.message ?? "A target file changed since the preview.",
        });
      } else {
        toast.success(
          mode === "local"
            ? `Wrote ${result.written.length} file${result.written.length === 1 ? "" : "s"}`
            : `Demo: simulated ${result.written.length} file write(s), nothing on disk`,
        );
      }
      await preview();
    } catch (err) {
      toast.error("Install failed", { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const changedCount = plan?.entries.filter((e) => chosen[e.target] && e.status !== "error").length ?? 0;

  return (
    <Panel
      title="install"
      actions={
        <>
          <Button size="xs" variant="ghost" onClick={() => void preview()} disabled={busy}>
            <RefreshCw className="size-3" /> Re-check
          </Button>
          <Button size="xs" onClick={() => void write()} disabled={busy || changedCount === 0 || !plan?.valid}>
            <Download className="size-3" /> Write {changedCount || ""}
          </Button>
        </>
      }
    >
      {dirty && (
        <p className="border-b bg-accent/40 px-3 py-1.5 font-mono text-[10px] text-accent-foreground">
          Unsaved edits are not installed. Save the profile first.
        </p>
      )}
      {mode === "demo" && (
        <p className="border-b bg-accent/40 px-3 py-1.5 font-mono text-[10px] text-accent-foreground">
          Demo mode: target files are simulated in this browser only.
        </p>
      )}
      {error && <p className="p-3 font-mono text-[11px] text-destructive">{error}</p>}
      {plan && !plan.valid && (
        <p className="border-b px-3 py-1.5 font-mono text-[10px] text-destructive">
          This profile does not validate, so installing is blocked.
        </p>
      )}
      {plan && plan.entries.length === 0 && (
        <EmptyState title="No targets" hint="Add targets to this profile, and define their directories in targets.yaml." />
      )}
      <ul className="divide-y">
        {(plan?.entries ?? []).map((entry) => (
          <li key={entry.target} className="px-2.5 py-2">
            <div className="flex items-center gap-2">
              <Checkbox
                checked={!!chosen[entry.target]}
                disabled={entry.status === "error"}
                onCheckedChange={(v) => setChosen((prev) => ({ ...prev, [entry.target]: v === true }))}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-[11px] text-foreground">{entry.target}</p>
                <p className="truncate font-mono text-[10px] text-muted-foreground">
                  {entry.filePath || entry.message}
                </p>
              </div>
              <span className={`shrink-0 font-mono text-[10px] uppercase ${STATUS_STYLE[entry.status]}`}>
                {entry.status}
              </span>
            </div>
            {entry.diff && (
              <div className="mt-1.5 overflow-hidden rounded border">
                <DiffView patch={entry.diff} className="max-h-48" />
              </div>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
