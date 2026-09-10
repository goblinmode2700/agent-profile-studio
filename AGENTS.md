# Contributor instructions

This repository contains a local editor for agent JSON profiles.

- Keep reusable rendering logic in `src/core/` and filesystem operations in `server/`.
- Preserve the launcher schema in `src/core/schema.ts` unless a task explicitly changes it.
- Keep Handlebars rendering separate from the launcher's dollar placeholders.
- Keep the API on loopback. Do not add remote storage or telemetry.
- Keep personal stores, credentials, and machine-specific paths out of commits.
- Run `npm test`, `npm run typecheck`, and `npm run build` after code changes.
- Document API changes in `docs/api.md`.
- Document known limitations without claiming concurrent editing is safe.
