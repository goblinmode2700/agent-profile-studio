/**
 * The launcher schema, reproduced exactly as specified. No key is added or removed.
 * This is the single source of truth for both the browser and the Node server.
 */
export const AGENT_PROFILE_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "AgentProfile",
  type: "object",
  additionalProperties: false,
  properties: {
    provider: { type: "string", enum: ["claude", "codex"], default: "claude" },
    model: { type: ["string", "null"], default: null },
    effort: { type: ["string", "null"], default: null },
    prompt: {
      type: ["object", "null"],
      default: null,
      additionalProperties: false,
      required: ["template"],
      properties: {
        template: { type: "string" },
        mode: { type: "string", enum: ["append", "replace"], default: "append" },
      },
    },
    autonomy: {
      type: "string",
      enum: ["read_only", "edit", "autonomous"],
      default: "edit",
    },
    cwd: { type: ["string", "null"], default: null },
    account: { type: ["string", "null"], default: null },
    session: {
      type: "object",
      additionalProperties: false,
      properties: {
        mode: {
          type: "string",
          enum: ["new", "continue", "resume", "seat"],
          default: "new",
        },
        id: { type: ["string", "null"], default: null },
      },
    },
    settings: { type: ["string", "null"], default: null },
    output: { type: "string", enum: ["text", "json", "stream"], default: "text" },
    worktree: { type: ["boolean", "string"], default: false },
    sub_alias: { type: ["string", "null"], default: null },
    extra: { type: "array", items: { type: "string" }, default: [] },
    strict_flags: { type: "boolean", default: false },
    repo_map: { type: "boolean", default: false },
  },
} as const;

/** Every key the launcher understands. Nothing else is ever written to the output JSON. */
export const PROFILE_FIELDS = Object.keys(AGENT_PROFILE_SCHEMA.properties) as string[];

/** Keys allowed inside a profile document (not the launcher output). */
export const PROFILE_DOC_FIELDS = [
  "role",
  "imports",
  "layout",
  "variables",
  "overrides",
  "targets",
] as const;

/** Concatenated rather than replaced when fragments are deep-merged. */
export const CONCAT_FIELDS = ["extra"] as const;
