import { createFileRoute } from "@tanstack/react-router";
import { Save, Undo2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { PageHeader } from "@/components/studio/AppShell";
import { CodeEditor } from "@/components/studio/CodeEditor";
import { useTimingLabel } from "@/lib/use-hydrated";
import { DocList } from "@/components/studio/DocList";
import { IssueList } from "@/components/studio/IssueList";
import { EmptyState, Panel } from "@/components/studio/Panel";
import { Button } from "@/components/ui/button";
import { validateDollarPlaceholders } from "@/core/dollars";
import { renderTemplate } from "@/core/render";
import { parseYaml } from "@/core/yaml";
import { useStudio } from "@/lib/studio";

export const Route = createFileRoute("/partials")({
  head: () => ({
    meta: [
      { title: "Partials — Agent Profile Studio" },
      {
        name: "description",
        content:
          "Write and test reusable Handlebars prompt partials on their own, with a sample input beside the editor and the rendered output underneath.",
      },
      { property: "og:title", content: "Partials — Agent Profile Studio" },
      {
        property: "og:description",
        content: "Write and test reusable Handlebars prompt partials with a sample input and live output.",
      },
    ],
  }),
  component: PartialsPage,
});

const NEW_PARTIAL = `One reusable paragraph. Use {{variables}} and $project or $cwd.
`;

function PartialsPage() {
  const { list, content, setDraft, discard, isDirty, save, create, remove, view, mode, storePath } =
    useStudio();
  const partials = list("partial");
  const [selected, setSelected] = useState<string | null>(null);
  const [inputText, setInputText] = useState("review: spec-03\nreadout:\n  format: markdown\n");

  useEffect(() => {
    if (!selected && partials.length) setSelected(partials[0]!.name);
    if (selected && !partials.some((p) => p.name === selected)) setSelected(partials[0]?.name ?? null);
  }, [partials, selected]);

  const source = selected ? content("partial", selected) : "";
  const selectedPath = partials.find((doc) => doc.name === selected)?.path ?? `catalog/prompt/${selected}.hbs`;

  const result = useMemo(() => {
    if (!selected) return null;
    const parsedInput = parseYaml<Record<string, unknown>>(inputText, "input.yaml");
    const rendered = renderTemplate({
      layout: `{{> ${selected}}}`,
      partials: view.partials,
      helpers: view.helpers,
      input: parsedInput.value ?? {},
      file: selectedPath,
    });
    const dollars = validateDollarPlaceholders(rendered.text, { partial: selected });
    return {
      text: rendered.text,
      issues: [...parsedInput.issues, ...rendered.issues, ...dollars],
      ms: rendered.ms,
    };
  }, [inputText, selected, selectedPath, view]);

  const usedBy = useMemo(() => {
    if (!selected) return [];
    return list("profile")
      .filter((p) => content("profile", p.name).includes(`{{> ${selected}`))
      .map((p) => p.name);
  }, [content, list, selected]);

  const dirty = selected ? isDirty("partial", selected) : false;

  const renderedTitle = useTimingLabel("rendered", result?.ms);

  return (
    <>
      <PageHeader
        title="Partials"
        subtitle={mode === "local" ? `${storePath}/catalog/prompt` : "demo store · catalog/prompt"}
      />
      <div className="grid min-h-0 flex-1 grid-cols-[13rem_1fr] gap-2 overflow-hidden p-2">
        <DocList
          title="catalog/prompt"
          docs={partials}
          selected={selected}
          onSelect={setSelected}
          onCreate={(name) => void create("partial", name, NEW_PARTIAL).then(() => setSelected(name))}
          onDelete={(name) => void remove("partial", name)}
          isDirty={(name) => isDirty("partial", name)}
          emptyHint="A partial is one reusable paragraph of a prompt."
          newLabel="partial-name"
        />
        {!selected ? (
          <EmptyState title="No partial selected" hint="Pick a partial, or create one with the + button." />
        ) : (
          <div className="grid min-h-0 grid-rows-2 gap-2">
            <div className="grid min-h-0 grid-cols-[1.6fr_1fr] gap-2">
              <Panel
                title={selectedPath}
                actions={
                  <>
                    {dirty && <span className="font-mono text-[10px] text-primary">unsaved</span>}
                    <Button size="xs" variant="ghost" disabled={!dirty} onClick={() => discard("partial", selected)}>
                      <Undo2 className="size-3" />
                    </Button>
                    <Button size="xs" disabled={!dirty} onClick={() => void save("partial", selected)}>
                      <Save className="size-3" /> Save
                    </Button>
                  </>
                }
              >
                <CodeEditor
                  language="handlebars"
                  value={source}
                  onChange={(next) => setDraft("partial", selected, next)}
                />
              </Panel>
              <Panel title="test input · yaml">
                <CodeEditor language="yaml" value={inputText} onChange={setInputText} />
              </Panel>
            </div>
            <div className="grid min-h-0 grid-cols-[1.6fr_1fr] gap-2">
              <Panel title={renderedTitle}>
                <pre className="whitespace-pre-wrap p-2.5 font-mono text-[11.5px] leading-relaxed">
                  {result?.text || "(empty)"}
                </pre>
              </Panel>
              <div className="grid min-h-0 grid-rows-2 gap-2">
                <Panel title="checks">
                  <IssueList issues={result?.issues ?? []} okLabel="Renders, and only $project / $cwd appear." />
                </Panel>
                <Panel title="used by">
                  {usedBy.length === 0 ? (
                    <p className="p-2.5 font-mono text-[11px] text-muted-foreground">No profile names this partial.</p>
                  ) : (
                    <ul className="p-2.5 font-mono text-[11px] leading-relaxed">
                      {usedBy.map((name) => (
                        <li key={name}>profiles/{name}.yaml</li>
                      ))}
                    </ul>
                  )}
                </Panel>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
