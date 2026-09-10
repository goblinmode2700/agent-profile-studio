import { createFileRoute } from "@tanstack/react-router";
import { Plus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { PageHeader } from "@/components/studio/AppShell";
import { CodeEditor } from "@/components/studio/CodeEditor";
import { useTimingLabel } from "@/lib/use-hydrated";
import { IssueList } from "@/components/studio/IssueList";
import { Panel } from "@/components/studio/Panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { buildProfile } from "@/core/pipeline";
import { partialClosure, renderTemplate } from "@/core/render";
import type { ProfileDoc } from "@/core/types";
import { parseYaml, toYaml } from "@/core/yaml";
import { useStudio } from "@/lib/studio";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/playground")({
  validateSearch: (search: Record<string, unknown>) => ({
    from: typeof search["from"] === "string" ? (search["from"] as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Playground — Agent Profile Studio" },
      {
        name: "description",
        content:
          "A Handlebars workspace: one template, any number of partials you can add, rename and remove, an input editor, and the output or the error.",
      },
      { property: "og:title", content: "Playground — Agent Profile Studio" },
      {
        property: "og:description",
        content: "A Handlebars workspace with template, partials, input and output.",
      },
    ],
  }),
  component: PlaygroundPage,
});

const DEFAULT_TEMPLATE = `{{> greeting}}

Costs are written like 100$$, and $project is left alone.
`;
const DEFAULT_PARTIALS: Record<string, string> = {
  greeting: "Hello {{name}}, welcome to {{place}}.\n",
};
const DEFAULT_INPUT = "name: reader\nplace: the studio\n";

function PlaygroundPage() {
  const { from } = Route.useSearch();
  const { content, view, list } = useStudio();

  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
  const [partials, setPartials] = useState<Record<string, string>>(DEFAULT_PARTIALS);
  const [inputText, setInputText] = useState(DEFAULT_INPUT);
  const [active, setActive] = useState<string>("greeting");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [loadedFrom, setLoadedFrom] = useState<string | null>(null);

  // "Open in playground" from a profile: load its layout, its partials and its render input.
  useEffect(() => {
    if (!from || loadedFrom === from) return;
    if (!list("profile").some((p) => p.name === from)) return;
    const doc = parseYaml<ProfileDoc>(content("profile", from), `profiles/${from}.yaml`).value;
    if (!doc) return;
    const built = buildProfile(doc, view);
    // Partials the layout names, plus every partial those partials name, transitively.
    const closure = partialClosure(doc.layout ?? "", view.partials);
    const used: Record<string, string> = { ...closure.used };
    for (const name of closure.missing) used[name] = "";
    setTemplate(doc.layout ?? "");
    setPartials(used);
    setActive(Object.keys(used)[0] ?? "");
    setInputText(toYaml(built.renderInput));
    setLoadedFrom(from);
  }, [content, from, list, loadedFrom, view]);

  const result = useMemo(() => {
    const parsedInput = parseYaml<Record<string, unknown>>(inputText, "input.yaml");
    const rendered = renderTemplate({
      layout: template,
      partials,
      helpers: view.helpers,
      input: parsedInput.value ?? {},
      file: "playground",
    });
    return { ...rendered, issues: [...parsedInput.issues, ...rendered.issues] };
  }, [inputText, partials, template, view.helpers]);

  const addPartial = () => {
    let name = "partial";
    let index = 1;
    while (name in partials) name = `partial-${++index}`;
    setPartials((prev) => ({ ...prev, [name]: "New partial for {{name}}.\n" }));
    setActive(name);
  };

  const removePartial = (name: string) => {
    setPartials((prev) => {
      const next = { ...prev };
      delete next[name];
      if (active === name) setActive(Object.keys(next)[0] ?? "");
      return next;
    });
  };

  const commitRename = (oldName: string) => {
    const next = renameValue.trim();
    setRenaming(null);
    if (!next || next === oldName || next in partials) return;
    setPartials((prev) => {
      const entries = Object.entries(prev).map(([k, v]) => (k === oldName ? [next, v] : [k, v]));
      return Object.fromEntries(entries) as Record<string, string>;
    });
    setActive(next);
  };

  const outputTitle = useTimingLabel("output", result.ms);

  return (
    <>
      <PageHeader
        title="Playground"
        subtitle={
          from ? `loaded from profiles/${from}.yaml — edits here are not saved to the store` : "scratch workspace"
        }
      />
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-2 overflow-hidden p-2">
        <div className="grid min-h-0 grid-rows-2 gap-2">
          <Panel title="template">
            <CodeEditor language="handlebars" value={template} onChange={setTemplate} />
          </Panel>
          <Panel
            title="partials"
            actions={
              <Button size="xs" variant="ghost" onClick={addPartial}>
                <Plus className="size-3" /> Add
              </Button>
            }
            bodyClassName="flex flex-col"
          >
            <div className="flex flex-wrap items-center gap-1 border-b p-1.5">
              {Object.keys(partials).length === 0 && (
                <span className="px-1 font-mono text-[10px] text-muted-foreground">no partials</span>
              )}
              {Object.keys(partials).map((name) =>
                renaming === name ? (
                  <Input
                    key={name}
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => commitRename(name)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename(name);
                      if (e.key === "Escape") setRenaming(null);
                    }}
                    className="h-6 w-28 font-mono text-[11px]"
                  />
                ) : (
                  <span
                    key={name}
                    className={cn(
                      "flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px]",
                      active === name
                        ? "border-primary/40 bg-primary/15 text-primary"
                        : "text-muted-foreground hover:bg-muted/60",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setActive(name)}
                      onDoubleClick={() => {
                        setRenaming(name);
                        setRenameValue(name);
                      }}
                      title="Click to edit, double-click to rename"
                    >
                      {name}
                    </button>
                    <button type="button" onClick={() => removePartial(name)} title="Remove">
                      <X className="size-2.5" />
                    </button>
                  </span>
                ),
              )}
            </div>
            <div className="min-h-0 flex-1">
              {active && partials[active] !== undefined ? (
                <CodeEditor
                  language="handlebars"
                  value={partials[active]}
                  onChange={(next) => setPartials((prev) => ({ ...prev, [active]: next }))}
                />
              ) : (
                <p className="p-2.5 font-mono text-[11px] text-muted-foreground">
                  Add a partial, then name it from the template with {"{{> name}}"}.
                </p>
              )}
            </div>
          </Panel>
        </div>
        <div className="grid min-h-0 grid-rows-[1fr_1.2fr_auto] gap-2">
          <Panel title="input · yaml or json">
            <CodeEditor language="yaml" value={inputText} onChange={setInputText} />
          </Panel>
          <Panel title={outputTitle}>
            <pre className="whitespace-pre-wrap p-2.5 font-mono text-[11.5px] leading-relaxed">
              {result.text || "(empty)"}
            </pre>
          </Panel>
          <Panel title="errors" className="max-h-48">
            <IssueList issues={result.issues} okLabel="Template compiles and every partial resolves." />
          </Panel>
        </div>
      </div>
    </>
  );
}
