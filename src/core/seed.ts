/**
 * The seeded example store. Used to initialise an empty local store directory and to
 * populate the hosted demo mode. Small, but enough to exercise the whole spec:
 * three fragments, three partials, one helper, one profile with two targets.
 */
export interface SeedFile {
  path: string;
  content: string;
}

export const SEED_FILES: SeedFile[] = [
  {
    path: "catalog/config/model-sonnet-medium.yaml",
    content: `provider: claude
model: claude-sonnet-4-6
effort: medium
output: text
`,
  },
  {
    path: "catalog/config/session-new.yaml",
    content: `session:
  mode: new
  id: null
autonomy: edit
strict_flags: false
`,
  },
  {
    path: "catalog/config/reads-two-repositories.yaml",
    content: `repo_map: true
extra:
  - --add-dir
  - ../reference
  - --add-dir
  - ../project
`,
  },
  {
    path: "catalog/prompt/reader-role.hbs",
    content: `You review code for {{review}}.

Read the source in $project and report on it. Do not change anything you were not asked to change.
`,
  },
  {
    path: "catalog/prompt/write-boundary.hbs",
    content: `Write boundary: you may only write inside $cwd.

{{#if repo_map}}A repository map is available; use it before opening files at random.{{/if}}
`,
  },
  {
    path: "catalog/prompt/readout-contract.hbs",
    content: `Readout format: {{upper readout.format}}.

Return findings as a list. Each finding names the file and the line. Costs are written like 100$$.
`,
  },
  {
    path: "catalog/helpers/text.js",
    content: `// Handlebars helpers are loaded before rendering. Either shape works:
//   Handlebars.registerHelper(...)   or   module.exports = (Handlebars) => { ... }
Handlebars.registerHelper("upper", (value) => String(value ?? "").toUpperCase());
Handlebars.registerHelper("bullet", (value) => "- " + String(value ?? ""));
`,
  },
  {
    path: "profiles/code-reviewer.yaml",
    content: `role: code-reviewer
imports:
  - model-sonnet-medium
  - session-new
  - reads-two-repositories
layout: |
  {{> reader-role}}

  {{> write-boundary}}

  {{> readout-contract}}
variables:
  review: spec-03
  readout:
    format: markdown
overrides:
  effort: high
targets:
  - reference-project
  - main-project
`,
  },
  {
    path: "targets.yaml",
    content: `# Named destinations a profile installs into.
# Absolute paths are used as-is; relative paths resolve against the store directory.
reference-project:
  directory: ./out/reference-project
main-project:
  directory: ./out/main-project
`,
  },
];
