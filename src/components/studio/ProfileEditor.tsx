import { Link } from "@tanstack/react-router";
import { FlaskConical, Save, Undo2 } from "lucide-react";
import { useMemo } from "react";

import { CodeEditor } from "@/components/studio/CodeEditor";
import { HistoryPanel } from "@/components/studio/HistoryPanel";
import { InstallPanel } from "@/components/studio/InstallPanel";
import { IssueList } from "@/components/studio/IssueList";
import { Panel } from "@/components/studio/Panel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { buildProfile } from "@/core/pipeline";
import type { ProfileDoc } from "@/core/types";
import { parseYaml, updateYamlPath } from "@/core/yaml";
import { useStudio } from "@/lib/studio";
import { useTimingLabel } from "@/lib/use-hydrated";

export function ProfileEditor({ role }: { role: string }) {
  const { content, setDraft, discard, isDirty, save, view, list, snapshot } = useStudio();
  const source = content("profile", role);
  const parsed = useMemo(() => parseYaml<ProfileDoc>(source, `profiles/${role}.yaml`), [role, source]);
  const doc = parsed.value;
  const built = useMemo(() => (doc ? buildProfile(doc, view) : null), [doc, view]);
  const issues = [...parsed.issues, ...(built?.issues ?? [])];
  const dirty = isDirty("profile", role);
  const fragments = list("fragment");
  const targetNames = Object.keys(parseYaml<Record<string, unknown>>(snapshot?.targets ?? "", "targets.yaml").value ?? {});
  const imports = Array.isArray(doc?.imports) ? doc.imports : [];
  const targets = Array.isArray(doc?.targets) ? doc.targets : [];
  const promptTitle = useTimingLabel("rendered prompt", built?.renderMs);

  const structuredUpdate = (path: string, value: unknown) => {
    if (!doc) return;
    const updated = updateYamlPath(source, `profiles/${role}.yaml`, [path], value);
    if (updated.issues.length === 0) setDraft("profile", role, updated.text);
  };
  const toggle = (field: "imports" | "targets", current: string[], name: string) =>
    structuredUpdate(field, current.includes(name) ? current.filter((n) => n !== name) : [...current, name]);

  return (
    <div className="grid min-h-0 flex-1 grid-cols-2 gap-2 p-2">
      <div className="flex min-h-0 flex-col gap-2">
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="font-mono text-[11px] text-muted-foreground">profiles/{role}.yaml</span>
          {dirty && <span className="font-mono text-[10px] text-primary">unsaved</span>}
          <div className="ml-auto flex gap-1">
            <Button size="xs" variant="ghost" asChild><Link to="/playground" search={{ from: role }}><FlaskConical className="size-3" /> Playground</Link></Button>
            <Button size="xs" variant="ghost" disabled={!dirty} onClick={() => discard("profile", role)}><Undo2 className="size-3" /> Revert</Button>
            <Button size="xs" disabled={!dirty} onClick={() => void save("profile", role)}><Save className="size-3" /> Save</Button>
          </div>
        </div>

        <Panel title="profile source · authoritative YAML" className="min-h-64 flex-1">
          <CodeEditor language="yaml" value={source} onChange={(next) => setDraft("profile", role, next)} />
        </Panel>

        <div className="grid max-h-56 shrink-0 grid-cols-2 gap-2">
          <Panel title="imports · structured control">
            {!doc ? <p className="p-2.5 text-[11px] text-destructive">Fix the YAML source to resume structured editing.</p> :
              <ul className="p-1.5">{fragments.map((fragment) => <li key={fragment.name} className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-muted/50">
                <Checkbox checked={imports.includes(fragment.name)} onCheckedChange={() => toggle("imports", imports, fragment.name)} />
                <span className="font-mono text-[11px]">{fragment.name}</span>
                {imports.includes(fragment.name) && <span className="ml-auto font-mono text-[10px] text-muted-foreground">#{imports.indexOf(fragment.name) + 1}</span>}
              </li>)}</ul>}
          </Panel>
          <Panel title="targets · structured control">
            {!doc ? <p className="p-2.5 text-[11px] text-destructive">Fix the YAML source to resume structured editing.</p> :
              <ul className="p-1.5">{targetNames.map((name) => <li key={name} className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-muted/50">
                <Checkbox checked={targets.includes(name)} onCheckedChange={() => toggle("targets", targets, name)} />
                <span className="font-mono text-[11px]">{name}</span>
              </li>)}</ul>}
          </Panel>
        </div>
      </div>

      <Tabs defaultValue="preview" className="flex min-h-0 flex-col gap-2">
        <TabsList className="h-7 w-full shrink-0 justify-start bg-card p-0.5">
          <TabsTrigger value="preview" className="h-6 px-2 text-[11px]">Preview</TabsTrigger>
          <TabsTrigger value="install" className="h-6 px-2 text-[11px]">Install</TabsTrigger>
          <TabsTrigger value="history" className="h-6 px-2 text-[11px]">History</TabsTrigger>
        </TabsList>
        <TabsContent value="preview" className="m-0 flex min-h-0 flex-1 flex-col gap-2">
          <Panel title={promptTitle} className="min-h-32 flex-1"><pre className="whitespace-pre-wrap p-2.5 font-mono text-[11.5px] leading-relaxed">{built?.promptText || "(empty)"}</pre></Panel>
          <Panel title={`${role}.json`} className="min-h-32 flex-1"><CodeEditor language="json" value={built?.jsonText ?? ""} readOnly /></Panel>
          <Panel title="validation · draft 2020-12" className="max-h-56 shrink-0" actions={<span className={`font-mono text-[10px] ${built?.valid ? "text-primary" : "text-destructive"}`}>{built?.valid ? "valid" : `${issues.filter((i) => i.severity === "error").length} errors`}</span>}>
            <IssueList issues={issues} okLabel="Valid against the launcher schema." />
          </Panel>
        </TabsContent>
        <TabsContent value="install" className="m-0 flex min-h-0 flex-1 flex-col"><InstallPanel role={role} dirty={dirty || !built?.valid} /></TabsContent>
        <TabsContent value="history" className="m-0 flex min-h-0 flex-1 flex-col"><HistoryPanel kind="profile" name={role} /></TabsContent>
      </Tabs>
    </div>
  );
}
