import { Link } from "@tanstack/react-router";
import { FlaskConical, Save, Undo2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { CodeEditor } from "@/components/studio/CodeEditor";
import { useTimingLabel } from "@/lib/use-hydrated";
import { HistoryPanel } from "@/components/studio/HistoryPanel";
import { InstallPanel } from "@/components/studio/InstallPanel";
import { IssueList } from "@/components/studio/IssueList";
import { Panel } from "@/components/studio/Panel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { buildProfile } from "@/core/pipeline";
import type { ProfileDoc, StudioIssue } from "@/core/types";
import { parseYaml, toYaml } from "@/core/yaml";
import { useStudio } from "@/lib/studio";

interface EditorState {
  layout: string;
  variablesText: string;
  overridesText: string;
  imports: string[];
  targets: string[];
}

function serialize(role: string, state: EditorState, variables: unknown, overrides: unknown): string {
  const doc: Record<string, unknown> = { role };
  if (state.imports.length) doc["imports"] = state.imports;
  if (state.layout.trim()) doc["layout"] = state.layout.endsWith("\n") ? state.layout : `${state.layout}\n`;
  if (variables && Object.keys(variables as object).length) doc["variables"] = variables;
  if (overrides && Object.keys(overrides as object).length) doc["overrides"] = overrides;
  if (state.targets.length) doc["targets"] = state.targets;
  return toYaml(doc);
}

export function ProfileEditor({ role }: { role: string }) {
  const { content, setDraft, discard, isDirty, save, view, list, snapshot, restoreTick } = useStudio();
  const saved = content("profile", role);

  const [state, setState] = useState<EditorState | null>(null);

  // Load the selected profile into the structured editor.
  useEffect(() => {
    const parsed = parseYaml<ProfileDoc>(saved, `profiles/${role}.yaml`).value ?? {};
    setState({
      layout: parsed.layout ?? "",
      variablesText: toYaml(parsed.variables ?? undefined),
      overridesText: toYaml(parsed.overrides ?? undefined),
      imports: parsed.imports ?? [],
      targets: parsed.targets ?? [],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, restoreTick]);

  const parsedParts = useMemo(() => {
    if (!state) return null;
    const variables = parseYaml<Record<string, unknown>>(state.variablesText, `profiles/${role}.yaml (variables)`);
    const overrides = parseYaml<Record<string, unknown>>(state.overridesText, `profiles/${role}.yaml (overrides)`);
    return { variables, overrides };
  }, [role, state]);

  const doc: ProfileDoc | null = useMemo(() => {
    if (!state || !parsedParts) return null;
    return {
      role,
      imports: state.imports,
      layout: state.layout,
      variables: parsedParts.variables.value ?? {},
      overrides: parsedParts.overrides.value ?? {},
      targets: state.targets,
    };
  }, [parsedParts, role, state]);

  // Keep the YAML draft in step with the structured editor, so saving writes one file.
  useEffect(() => {
    if (!state || !parsedParts) return;
    const next = serialize(role, state, parsedParts.variables.value, parsedParts.overrides.value);
    if (next !== saved) setDraft("profile", role, next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsedParts, role, state]);

  const built = useMemo(() => (doc ? buildProfile(doc, view) : null), [doc, view]);

  const issues: StudioIssue[] = useMemo(
    () => [
      ...(parsedParts?.variables.issues ?? []),
      ...(parsedParts?.overrides.issues ?? []),
      ...(built?.issues ?? []),
    ],
    [built, parsedParts],
  );

  const promptTitle = useTimingLabel("rendered prompt", built?.renderMs);

  if (!state || !built) return null;

  const dirty = isDirty("profile", role);
  const fragments = list("fragment");
  const targetNames = Object.keys(
    parseYaml<Record<string, unknown>>(snapshot?.targets ?? "", "targets.yaml").value ?? {},
  );

  const toggle = (field: "imports" | "targets", name: string) =>
    setState((prev) =>
      prev
        ? {
            ...prev,
            [field]: prev[field].includes(name)
              ? prev[field].filter((n) => n !== name)
              : [...prev[field], name],
          }
        : prev,
    );

  return (
    <div className="grid min-h-0 flex-1 grid-cols-2 gap-2 p-2">
      {/* left: the editor */}
      <div className="flex min-h-0 flex-col gap-2">
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="font-mono text-[11px] text-muted-foreground">profiles/{role}.yaml</span>
          {dirty && <span className="font-mono text-[10px] text-primary">unsaved</span>}
          <div className="ml-auto flex gap-1">
            <Button size="xs" variant="ghost" asChild>
              <Link to="/playground" search={{ from: role }}>
                <FlaskConical className="size-3" /> Playground
              </Link>
            </Button>
            <Button size="xs" variant="ghost" disabled={!dirty} onClick={() => discard("profile", role)}>
              <Undo2 className="size-3" /> Revert
            </Button>
            <Button size="xs" disabled={!dirty} onClick={() => void save("profile", role)}>
              <Save className="size-3" /> Save
            </Button>
          </div>
        </div>

        <Panel title="imports · catalog/config" className="max-h-40 shrink-0">
          {fragments.length === 0 ? (
            <p className="p-2.5 text-[11px] text-muted-foreground">
              No fragments yet. Create one on the Fragments page.
            </p>
          ) : (
            <ul className="p-1.5">
              {fragments.map((fragment) => (
                <li key={fragment.name} className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-muted/50">
                  <Checkbox
                    checked={state.imports.includes(fragment.name)}
                    onCheckedChange={() => toggle("imports", fragment.name)}
                  />
                  <span className="font-mono text-[11px]">{fragment.name}</span>
                  {state.imports.includes(fragment.name) && (
                    <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                      #{state.imports.indexOf(fragment.name) + 1}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="layout · handlebars" className="min-h-40 flex-1">
          <CodeEditor
            language="handlebars"
            value={state.layout}
            onChange={(layout) => setState((prev) => (prev ? { ...prev, layout } : prev))}
            placeholder="{{> partial-name}}"
          />
        </Panel>

        <div className="grid min-h-32 flex-1 grid-cols-2 gap-2">
          <Panel title="variables · yaml">
            <CodeEditor
              language="yaml"
              value={state.variablesText}
              onChange={(variablesText) => setState((prev) => (prev ? { ...prev, variablesText } : prev))}
              placeholder="review: spec-03"
            />
          </Panel>
          <Panel title="overrides · yaml">
            <CodeEditor
              language="yaml"
              value={state.overridesText}
              onChange={(overridesText) => setState((prev) => (prev ? { ...prev, overridesText } : prev))}
              placeholder="effort: high"
            />
          </Panel>
        </div>

        <Panel title="targets" className="max-h-28 shrink-0">
          {targetNames.length === 0 ? (
            <p className="p-2.5 text-[11px] text-muted-foreground">
              No targets defined. Edit targets.yaml on the Fragments page.
            </p>
          ) : (
            <ul className="p-1.5">
              {targetNames.map((name) => (
                <li key={name} className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-muted/50">
                  <Checkbox
                    checked={state.targets.includes(name)}
                    onCheckedChange={() => toggle("targets", name)}
                  />
                  <span className="font-mono text-[11px]">{name}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* right: live preview */}
      <Tabs defaultValue="preview" className="flex min-h-0 flex-col gap-2">
        <TabsList className="h-7 w-full shrink-0 justify-start bg-card p-0.5">
          <TabsTrigger value="preview" className="h-6 px-2 text-[11px]">
            Preview
          </TabsTrigger>
          <TabsTrigger value="install" className="h-6 px-2 text-[11px]">
            Install
          </TabsTrigger>
          <TabsTrigger value="history" className="h-6 px-2 text-[11px]">
            History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="preview" className="m-0 flex min-h-0 flex-1 flex-col gap-2">
          <Panel title={promptTitle} className="min-h-32 flex-1">
            <pre className="whitespace-pre-wrap p-2.5 font-mono text-[11.5px] leading-relaxed">
              {built.promptText || "(empty)"}
            </pre>
          </Panel>
          <Panel title={`${role}.json`} className="min-h-32 flex-1">
            <CodeEditor language="json" value={built.jsonText} readOnly />
          </Panel>
          <Panel
            title="validation · draft 2020-12"
            className="max-h-56 shrink-0"
            actions={
              <span className={`font-mono text-[10px] ${built.valid ? "text-primary" : "text-destructive"}`}>
                {built.valid ? "valid" : `${issues.filter((i) => i.severity === "error").length} errors`}
              </span>
            }
          >
            <IssueList issues={issues} okLabel="Valid against the launcher schema." />
          </Panel>
        </TabsContent>

        <TabsContent value="install" className="m-0 flex min-h-0 flex-1 flex-col">
          <InstallPanel role={role} dirty={dirty} />
        </TabsContent>

        <TabsContent value="history" className="m-0 flex min-h-0 flex-1 flex-col">
          <HistoryPanel kind="profile" name={role} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
