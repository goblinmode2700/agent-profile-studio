# Repair decisions

Base commit: `de43187611fdc8945d2238003d47a457f29f8653`.

## Prior-art verdict

PATTERN: static template dependency graph, source-preserving YAML editing, recursive filesystem catalog, and bounded local provider adapter.

MATURE: Handlebars parser supplies the template AST; `dependency-graph` 1.0.0 supplies iterative closure, ordering, and named cycle paths; YAML 2.9 Document nodes preserve comments and scalar presentation; `@headless-tree/react` 1.7.0 supplies accessible keyboard/tree state. The Node `execFile` API supplies argv-only subprocess execution without a shell.

LOCAL: the existing `src/core/render.ts`, `src/core/yaml.ts`, `server/store.ts`, and `server/config.ts` remain the integration points. No second parser, catalog database, template language, or governance framework is introduced.

VERDICT: adopt the four existing libraries/APIs above. Extend the current store and pipeline.

TAKE: static partial references, iterative reachable-graph checks, YAML node mutation, extension-derived catalog kinds, flat stem identity, accessible headless rows, and bounded executable-plus-arguments provider configuration.

REJECT: regex template parsing, recursive graph traversal, object-to-YAML regeneration, path-as-identity migration, shell command strings, and a persisted second project catalog.

## Authoring contracts

- A fragment can declare `promptText`. The field is removed before launcher validation and merging.
- The profile layout places the rendered aggregate with `{{fragmentPrompts}}`. Contributions are rendered once in import order and joined with exactly two newlines. Missing placement is a warning, never an implicit append.
- `prompt.template` is generated output. Explicit assignments in fragments, variables, or overrides are errors; `prompt.mode` remains supported.
- Supported dependency checks cover static `{{> name}}` partial statements parsed by Handlebars. Dynamic and block partials are rejected with source context. Arbitrary JavaScript helpers are not sandboxed.
- The profile YAML buffer is authoritative. Structured list edits mutate its YAML Document. Invalid YAML stays intact and disables structured controls.
- Existing target aliases remain. An alias declares exactly one of `directory` or `project`.
- Catalog identity remains the flat stem. Existing legacy names continue to read; new names must be kebab-case and globally unique across catalog extensions.

## Provisional acceptance

The Projects page and explicit `fragmentPrompts` placement are implemented with reversible defaults. They remain pending maintainer acceptance in the real workflow. Synthetic project-provider tests do not establish work-machine integration or launcher readback.
