import { createFileRoute } from "@tanstack/react-router";
import { Save, Undo2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { PageHeader } from "@/components/studio/AppShell";
import { CodeEditor } from "@/components/studio/CodeEditor";
import { DocList } from "@/components/studio/DocList";
import { IssueList } from "@/components/studio/IssueList";
import { EmptyState, Panel } from "@/components/studio/Panel";
import { Button } from "@/components/ui/button";
import type { DocKind } from "@/core/types";
import { validateProfileFieldSubset } from "@/core/validate";
import { parseYaml } from "@/core/yaml";
import { useStudio } from "@/lib/studio";

export const Route = createFileRoute("/fragments")({
  head: () => ({
    meta: [
      { title: "Fragments — Agent Profile Studio" },
      {
        name: "description",
        content:
          "Edit reusable config fragments in YAML with launcher-schema validation, see which profiles import each one, and maintain the install targets file.",
      },
      { property: "og:title", content: "Fragments — Agent Profile Studio" },
      {
        property: "og:description",
        content: "Reusable config fragments in YAML, validated against the launcher schema.",
      },
    ],
  }),
  component: FragmentsPage,
});

const NEW_FRAGMENT = `# Only launcher profile fields are allowed here.
model: null
`;

function FragmentsPage() {
  const { list, content, setDraft, discard, isDirty, save, create, remove, mode, storePath } = useStudio();
  const fragments = list("fragment");
  const helpers = list("helper");
  const [selected, setSelected] = useState<{ kind: DocKind; name: string } | null>(null);

  useEffect(() => {
    if (!selected && fragments.length) setSelected({ kind: "fragment", name: fragments[0]!.name });
  }, [fragments, selected]);

  const source = selected ? content(selected.kind, selected.name) : "";

  const filePath = selected
    ? selected.kind === "fragment"
      ? fragments.find((doc) => doc.name === selected.name)?.path ?? `catalog/config/${selected.name}.yaml`
      : selected.kind === "helper"
        ? helpers.find((doc) => doc.name === selected.name)?.path ?? `catalog/helpers/${selected.name}.js`
        : "targets.yaml"
    : "";

  const issues = useMemo(() => {
    if (!selected || selected.kind === "helper") return [];
    const parsed = parseYaml<Record<string, unknown>>(source, filePath);
    if (parsed.issues.length) return parsed.issues;
    if (selected.kind === "targets") {
      const value = parsed.value ?? {};
      return Object.entries(value)
        .filter(([, def]) => !(def as { directory?: string })?.directory)
        .map(([name]) => ({
          severity: "error" as const,
          file: "targets.yaml",
          field: name,
          message: `targets.yaml: target "${name}" needs a "directory".`,
        }));
    }
    return validateProfileFieldSubset(parsed.value ?? {}, filePath, "fragment");
  }, [filePath, selected, source]);

  const importedBy = useMemo(() => {
    if (!selected || selected.kind !== "fragment") return [];
    return list("profile")
      .filter((p) => (parseYaml<{ imports?: string[] }>(content("profile", p.name), p.name).value?.imports ?? []).includes(selected.name))
      .map((p) => p.name);
  }, [content, list, selected]);

  const dirty = selected ? isDirty(selected.kind, selected.name) : false;

  return (
    <>
      <PageHeader
        title="Fragments"
        subtitle={mode === "local" ? `${storePath}/catalog/config` : "demo store · catalog/config"}
      />
      <div className="grid min-h-0 flex-1 grid-cols-[13rem_1fr] gap-2 overflow-hidden p-2">
        <div className="grid min-h-0 grid-rows-[1fr_auto_auto] gap-2">
          <DocList
            title="catalog/config"
            docs={fragments}
            selected={selected?.kind === "fragment" ? selected.name : null}
            onSelect={(name) => setSelected({ kind: "fragment", name })}
            onCreate={(name) =>
              void create("fragment", name, NEW_FRAGMENT).then(() => setSelected({ kind: "fragment", name }))
            }
            onDelete={(name) => void remove("fragment", name)}
            isDirty={(name) => isDirty("fragment", name)}
            emptyHint="A fragment is any subset of the launcher profile fields."
            newLabel="fragment-name"
          />
          <DocList
            title="catalog/helpers"
            docs={helpers}
            selected={selected?.kind === "helper" ? selected.name : null}
            onSelect={(name) => setSelected({ kind: "helper", name })}
            onCreate={(name) =>
              void create(
                "helper",
                name,
                `Handlebars.registerHelper("${name}", (value) => String(value ?? ""));\n`,
              ).then(() => setSelected({ kind: "helper", name }))
            }
            onDelete={(name) => void remove("helper", name)}
            isDirty={(name) => isDirty("helper", name)}
            emptyHint="Optional Handlebars helper registrations."
            newLabel="helper-name"
          />
          <Panel title="configuration">
            <button
              type="button"
              onClick={() => setSelected({ kind: "targets", name: "targets" })}
              className={`w-full px-2.5 py-1.5 text-left font-mono text-[11px] hover:bg-muted/60 ${
                selected?.kind === "targets" ? "bg-accent text-accent-foreground" : ""
              }`}
            >
              targets.yaml
              {isDirty("targets", "targets") && <span className="ml-1 text-primary">•</span>}
            </button>
          </Panel>
        </div>

        {!selected ? (
          <EmptyState title="No fragment selected" hint="Pick a fragment, or create one with the + button." />
        ) : (
          <div className="grid min-h-0 grid-cols-[1.5fr_1fr] gap-2">
            <Panel
              title={filePath}
              actions={
                <>
                  {dirty && <span className="font-mono text-[10px] text-primary">unsaved</span>}
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={!dirty}
                    onClick={() => discard(selected.kind, selected.name)}
                  >
                    <Undo2 className="size-3" />
                  </Button>
                  <Button size="xs" disabled={!dirty} onClick={() => void save(selected.kind, selected.name)}>
                    <Save className="size-3" /> Save
                  </Button>
                </>
              }
            >
              <CodeEditor
                language={selected.kind === "helper" ? "javascript" : "yaml"}
                value={source}
                onChange={(next) => setDraft(selected.kind, selected.name, next)}
              />
            </Panel>
            <div className="grid min-h-0 grid-rows-2 gap-2">
              <Panel
                title="validation"
                actions={
                  selected.kind !== "helper" && (
                    <span className={`font-mono text-[10px] ${issues.length ? "text-destructive" : "text-primary"}`}>
                      {issues.length ? `${issues.length} errors` : "valid"}
                    </span>
                  )
                }
              >
                {selected.kind === "helper" ? (
                  <p className="p-2.5 font-mono text-[11px] leading-relaxed text-muted-foreground">
                    Helpers are plain JavaScript, loaded before rendering. Call
                    <span className="text-foreground"> Handlebars.registerHelper</span>, or export a function that
                    receives Handlebars. Errors appear where the helper is used.
                  </p>
                ) : (
                  <IssueList issues={issues} okLabel="Every field is a known launcher field." />
                )}
              </Panel>
              <Panel title={selected.kind === "fragment" ? "imported by" : "notes"}>
                {selected.kind === "fragment" ? (
                  importedBy.length === 0 ? (
                    <p className="p-2.5 font-mono text-[11px] text-muted-foreground">No profile imports this fragment.</p>
                  ) : (
                    <ul className="p-2.5 font-mono text-[11px] leading-relaxed">
                      {importedBy.map((name) => (
                        <li key={name}>profiles/{name}.yaml</li>
                      ))}
                    </ul>
                  )
                ) : (
                  <p className="p-2.5 font-mono text-[11px] leading-relaxed text-muted-foreground">
                    Target directories may be absolute, or relative to the store directory. The studio only ever writes
                    one file per target: &lt;role&gt;.json.
                  </p>
                )}
              </Panel>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
