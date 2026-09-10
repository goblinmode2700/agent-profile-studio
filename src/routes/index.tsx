import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { PageHeader } from "@/components/studio/AppShell";
import { DocList } from "@/components/studio/DocList";
import { EmptyState } from "@/components/studio/Panel";
import { ProfileEditor } from "@/components/studio/ProfileEditor";
import { useStudio } from "@/lib/studio";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Profiles — Agent Profile Studio" },
      {
        name: "description",
        content:
          "Compose an agent launcher profile from config fragments and Handlebars partials, with the rendered prompt, final JSON and schema validation updating as you type.",
      },
      { property: "og:title", content: "Profiles — Agent Profile Studio" },
      {
        property: "og:description",
        content:
          "Compose an agent launcher profile from config fragments and Handlebars partials, with live prompt, JSON and validation.",
      },
    ],
  }),
  component: ProfilesPage,
});

const NEW_PROFILE = (name: string) => `role: ${name}
imports: []
layout: |
  Write the prompt here, or name a partial with {{> partial-name}}.
variables: {}
overrides: {}
targets: []
`;

function ProfilesPage() {
  const { list, create, remove, isDirty, loading, error, mode, storePath } = useStudio();
  const profiles = list("profile");
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!selected && profiles.length) setSelected(profiles[0]!.name);
    if (selected && !profiles.some((p) => p.name === selected)) setSelected(profiles[0]?.name ?? null);
  }, [profiles, selected]);

  return (
    <>
      <PageHeader
        title="Profiles"
        subtitle={mode === "local" ? `${storePath}/profiles` : "demo store · profiles"}
      />
      {error && <p className="border-b bg-destructive/10 px-3 py-1.5 font-mono text-[11px] text-destructive">{error}</p>}
      <div className="grid min-h-0 flex-1 grid-cols-[13rem_1fr] gap-2 overflow-hidden p-2 pr-0">
        <DocList
          title="roles"
          docs={profiles}
          selected={selected}
          onSelect={setSelected}
          onCreate={(name) => void create("profile", name, NEW_PROFILE(name)).then(() => setSelected(name))}
          onDelete={(name) => void remove("profile", name)}
          isDirty={(name) => isDirty("profile", name)}
          emptyHint="Create a role to compose its prompt and launcher JSON."
          newLabel="role-name"
        />
        <div className="flex min-h-0 flex-col overflow-hidden">
          {loading ? (
            <EmptyState title="Loading the store…" />
          ) : selected ? (
            <ProfileEditor key={selected} role={selected} />
          ) : (
            <EmptyState
              title="No profile selected"
              hint="Pick a role on the left, or create one with the + button."
            />
          )}
        </div>
      </div>
    </>
  );
}
