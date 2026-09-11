import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { PageHeader } from "@/components/studio/AppShell";
import { Panel } from "@/components/studio/Panel";
import { Button } from "@/components/ui/button";
import { useStudio } from "@/lib/studio";

export const Route = createFileRoute("/projects")({ component: ProjectsPage });

interface Result {
  available: boolean;
  measuredAt: string;
  projects: Array<{ id: string; name: string; path: string; launcherProfileDirectory: string }>;
  error?: string;
}

function ProjectsPage() {
  const { api, mode } = useStudio();
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const refresh = async () => {
    if (!api) return;
    setLoading(true);
    try {
      setResult(await api.getProjects());
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void refresh();
  }, [api]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <PageHeader
        title="Projects"
        subtitle="optional governed destinations"
        actions={
          <Button size="xs" variant="ghost" disabled={loading} onClick={() => void refresh()}>
            <RefreshCw className="size-3" /> Refresh
          </Button>
        }
      />
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {!result?.available ? (
          <Panel title="provider unavailable" className="max-w-3xl">
            <div className="flex gap-2 p-3 text-xs text-muted-foreground">
              <AlertTriangle className="size-4 shrink-0 text-amber-500" />
              <div>
                <p>
                  Ordinary profile editing remains available. Governed installs are disabled until a
                  fresh provider query succeeds.
                </p>
                <p className="mt-1 font-mono text-[10px]">
                  {result?.error ??
                    (loading
                      ? "Querying provider…"
                      : mode === "demo"
                        ? "Local server not connected."
                        : "No result.")}
                </p>
                {result?.measuredAt && (
                  <p className="mt-1 font-mono text-[10px]">measured {result.measuredAt}</p>
                )}
              </div>
            </div>
          </Panel>
        ) : (
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {result.projects.map((project) => (
              <Panel key={project.id} title={project.name}>
                <dl className="space-y-2 p-3 font-mono text-[10px]">
                  <div>
                    <dt className="text-muted-foreground">stable project ID</dt>
                    <dd className="break-all">{project.id}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">recognized root</dt>
                    <dd className="break-all">{project.path}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">canonical launcher profiles</dt>
                    <dd className="break-all">{project.launcherProfileDirectory}</dd>
                  </div>
                </dl>
              </Panel>
            ))}
          </div>
        )}
        {result?.available && (
          <p className="mt-3 font-mono text-[10px] text-muted-foreground">
            Fresh provider measurement: {result.measuredAt}. Governed targets use{" "}
            <code>project: &lt;stable-id&gt;</code>; Studio re-resolves this mapping when applying
            an install.
          </p>
        )}
      </div>
    </>
  );
}
