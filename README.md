# Agent Profile Studio

**Handlebars for your agent JSON config.**

Build agent profiles from reusable configuration fragments and prompt paragraphs.
Edit YAML and Handlebars side by side with a live prompt preview and the final JSON.
Keep the source files in a local git repository, then install the output into named directories.

No account, hosted service, database, or agent launcher is required.

## What it does

- Compose profiles from YAML fragments with an explicit merge order.
- Reuse Handlebars partials, explicit fragment `promptText`, and JavaScript helpers.
- Edit profiles, fragments, partials, and scratch templates with CodeMirror.
- Check the output against a shared JSON Schema in the browser and server.
- Save documents as git commits, compare versions, and restore earlier content.
- Preview installation changes before writing `<role>.json` to each target.
- Read and save documents through a local HTTP API.

## Run locally

Use Node.js 24 LTS and npm 11 or later.

```sh
git clone https://github.com/goblinmode2700/agent-profile-studio.git
cd agent-profile-studio
npm ci
```

Start the store server in one terminal:

```sh
npm run studio
```

Start the interface in another terminal:

```sh
npm run dev
```

Open [localhost:8080](http://localhost:8080).
The sidebar shows `local store` when the interface connects to the server on port 4319.

An empty store gets an example profile, three fragments, three partials, one helper, and two targets.
The example targets stay inside the store directory.
Change them to your own profile directories before installation.

If the store server is unavailable, the interface uses a labelled browser demo.
Demo history and installed output stay in browser storage.
Only local mode writes real files and git commits.

## A profile is a file

```yaml
role: code-reviewer
imports:
  - model-sonnet-medium
  - session-new
  - reads-two-repositories
layout: |
  {{> reader-role}}

  {{> write-boundary}}

  {{> readout-contract}}
variables:
  review: example-review
  readout:
    format: markdown
overrides:
  effort: high
targets:
  - reference-project
  - main-project
```

The seeded store layout is shown below. Catalog directories are filing only: `.yaml`, `.hbs`, and `.js` determine document kind at any depth, while the flat stem remains its identity.

```text
store/
  catalog/
    config/<name>.yaml
    prompt/<name>.hbs
    helpers/<name>.js
  profiles/<role>.yaml
  targets.yaml
```

Imports merge in order, followed by variables and overrides.
Objects merge by key. Arrays replace earlier arrays, except `extra`, which concatenates in order.
The complete merged object feeds Handlebars.
Only schema-defined fields reach the output JSON.

Fragments and overrides reject unknown profile fields.
Variables can contain additional template data.
Fragments may declare a Studio-only `promptText` string. Place imported contributions explicitly with `{{fragmentPrompts}}` in the profile layout. The field never reaches launcher JSON.

## Output format

The bundled [schema](src/core/schema.ts) describes a launcher profile with providers `claude` and `codex`.
It includes model, effort, prompt, session, autonomy, paths, output format, and extra command-line tokens.

This version does **not** accept an arbitrary output schema through the UI.
Adapt the shared schema and pipeline if your launcher uses a different format.
The application creates configuration files. It does not launch agents or validate a provider's current command-line flags.

Handlebars renders the prompt now.
Your launcher can later substitute `$project` and `$cwd` using Python `string.Template` rules.
The studio preserves these placeholders, their braced forms, and `$$` exactly.
Other placeholders and malformed dollar expressions produce errors.

## Configuration

Edit `studio.config.json`:

```json
{
  "storePath": "./store",
  "targetsFile": "targets.yaml",
  "port": 4319,
  "allowedOrigins": ["http://localhost:8080", "http://127.0.0.1:8080"]
}
```

An optional governed project catalog uses an executable plus literal arguments, never a shell string:

```json
{
  "projectProvider": {
    "executable": "/absolute/path/to/provider",
    "args": ["projects", "--json"],
    "timeoutMs": 2000
  }
}
```

Provider output is either an array or `{ "projects": [...] }`. Each record must contain nonempty strings `id`, `name`, `path`, and `launcherProfileDirectory`. Project target aliases use `{ "project": "stable-id" }`; standalone aliases continue to use `{ "directory": "..." }`. A target cannot specify both. The provider is queried again during apply, so a mapping change requires a new preview.

`STUDIO_STORE`, `STUDIO_TARGETS`, and `STUDIO_PORT` override the file.
`VITE_STUDIO_API` sets the server address used by the interface.

Relative target directories resolve against the store.
An absolute targets-file path is external configuration: the editor can save it, but the store cannot track its history.

The server binds to loopback.
JavaScript helpers execute code in the local application, so use a store whose helpers you trust.
The application does not provide authentication or a remote collaboration service.

## Agents and humans

An agent can use the same [HTTP API](docs/api.md) as the interface.
API saves create git commits for documents inside the store.
Direct file edits are also possible, but they bypass automatic commits.

Take turns editing a document.
Document saves currently replace its full contents without checking the previous version.
The UI does not watch for external changes, and an unsaved draft can overwrite another writer's changes.
Git history provides recovery, not conflict prevention.

Installation checks are separate from document saves.
The UI sends the proposed output hash, resolved destination, and previous file hash when it confirms an install.
Changes to these values require a fresh comparison.

## Development

```sh
npm test
npm run typecheck
npm run build
```

To run the built interface, keep `npm run studio` active and run `npm start`.
The production interface also listens on port 8080.

The main directories are `src/core/` for rendering and validation, `server/` for files and git, and `src/components/studio/` for editors.
The [contributor instructions](AGENTS.md) describe the boundaries.
Local stores, environment files, and generated output are excluded from git.

## License and credits

[MIT](LICENSE). Copyright 2026 Darcy Rose and contributors.

The initial application was generated with Lovable, then reviewed and adapted for standalone local use.
This repository has no runtime dependency on Lovable.
Third-party components retain their own licenses. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
