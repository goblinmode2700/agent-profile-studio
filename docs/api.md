# Local HTTP API

The interface and an agent can use the same API at `http://127.0.0.1:4319`.
The default server has no authentication and binds to loopback.
Browser requests must use an allowed origin.
Native HTTP clients can call it without an Origin header.

The current TypeScript contract is [StudioApi](../src/lib/api.ts).
Routes are implemented in [server/index.ts](../server/index.ts).
This version has no MCP server or OpenAPI specification.

## Read the store

```sh
curl --fail-with-body http://127.0.0.1:4319/api/store
```

The response includes `profiles`, `fragments`, `partials`, `helpers`, targets-file content, document source paths, and `catalogDirectories` (including empty folders).
Each document has a flat-stem name, source text, and store-relative `path`.

## Save a document

`PUT /api/doc` accepts `kind`, `name`, and `content`. For a new fragment, partial, or helper, optional `directory` selects a catalog folder.

```sh
curl --fail-with-body http://127.0.0.1:4319/api/doc \
  -X PUT \
  -H 'Content-Type: application/json' \
  --data-binary @- <<'JSON'
{
  "kind": "partial",
  "name": "review-summary",
  "content": "Review {{review}} in $project.\n"
}
JSON
```

Kinds are `profile`, `fragment`, `partial`, `helper`, and `targets`.
Names are file stems. Use `targets` as the name for the configured targets document.
The server accepts plain document names without path traversal.

A save returns `{ "commit": { ... }, "path": "..." }`.
The commit is null for an external targets file.
Saving stores source text. It does not guarantee that the content produces valid launcher JSON.
The first save of an existing targets file also creates the non-overwritten backup reported as `targetsBackup` by `GET /api/health` and `GET /api/store`.

**Saves replace the complete document.**
There is no expected-version field, transaction across documents, or edit lock.
Coordinate writers and retain the source version before changing a document.

## History and restore

- `GET /api/health` returns the local server configuration and status.
- `GET /api/history?kind=profile&name=code-reviewer` returns commits.
- `GET /api/version?kind=profile&name=code-reviewer&oid=<commit>` returns source text.
- `GET /api/diff?kind=profile&name=code-reviewer&a=<commit>&b=<commit>` returns a unified diff.
- `POST /api/restore` accepts `{ "kind", "name", "oid" }` and creates a restore commit.
- `DELETE /api/doc?kind=partial&name=review-summary` removes a document and commits the deletion.

If `b` is absent, the diff compares `a` with the current file.
History operations are unavailable for an external targets file.

## Install output

First call `POST /api/install/preview`:

```json
{ "role": "code-reviewer" }
```

The server renders the saved profile and returns `jsonText`, `proposedHash`, `valid`, and target entries.
Each entry reports `new`, `unchanged`, `changed`, or `error`.
Changed entries contain a unified diff.

After review, call `POST /api/install/apply` with the preview values:

```json
{
  "role": "code-reviewer",
  "entries": [
    {
      "target": "main-project",
      "expectedHash": null,
      "proposedHash": "<proposedHash from preview>",
      "filePath": "<resolved filePath from preview>"
    }
  ]
}
```

Use null for `expectedHash` only when the preview reports a new file.
Otherwise, copy the entry's `existingHash`.
Always send all three comparison values.
The current server accepts omitted `proposedHash` and `filePath`, which skips those two comparisons.

Invalid output is refused.
A stale comparison returns HTTP 409 with `written` and `conflicts`.
Targets are processed individually: a conflict does not roll back another target already written.
Inspect both arrays before reporting success.

## Collaboration boundary

There is no file watcher, server event stream, or conflict check for document saves.
Refresh the UI after external edits and resolve unsaved drafts before another writer saves.
Do not use the installation checks as evidence that simultaneous document editing is safe.

## Additional catalog endpoints

The server remains loopback-only. Browser requests never supply executable commands.

### Project catalog

`GET /api/projects` runs the optional configured `projectProvider` as one executable plus literal arguments, with a bounded timeout and output buffer. It returns `{ available, measuredAt, projects, error? }`. Each project has `id`, `name`, `path`, and `launcherProfileDirectory`. Failure is data, not a server outage; ordinary editing remains available.

### Recursive catalog

`POST /api/catalog/directory`, `DELETE /api/catalog/directory`, and `POST /api/catalog/move` create/remove empty folders and move documents. Names remain flat stems.
