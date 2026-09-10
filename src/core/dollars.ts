import type { StudioIssue } from "./types";

/** Placeholders the launcher substitutes. Anything else is rejected. */
export const ALLOWED_PLACEHOLDERS = ["project", "cwd"];

const IDENT = /[A-Za-z_][A-Za-z0-9_]*/;

interface Found {
  name: string;
  index: number;
}

/**
 * Validate a rendered prompt against Python `string.Template` rules:
 *   $$        -> literal dollar, left untouched
 *   $name     -> placeholder
 *   ${name}   -> braced placeholder
 *   anything else after a `$` is malformed and rejected
 * Only `project` and `cwd` are permitted placeholder names.
 *
 * The text itself is never rewritten: every `$` in the rendered prompt is preserved verbatim.
 */
export function validateDollarPlaceholders(
  text: string,
  context: { file?: string; partial?: string } = {},
): StudioIssue[] {
  const issues: StudioIssue[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch !== "$") {
      i += 1;
      continue;
    }
    const next = text[i + 1];
    if (next === "$") {
      i += 2; // escaped literal dollar
      continue;
    }
    if (next === "{") {
      const close = text.indexOf("}", i + 2);
      const inner = close === -1 ? "" : text.slice(i + 2, close);
      if (close === -1 || !new RegExp(`^${IDENT.source}$`).test(inner)) {
        issues.push(issue(text, i, `malformed placeholder \${${inner}${close === -1 ? "" : "}"}`, context));
        i += 2;
        continue;
      }
      if (!ALLOWED_PLACEHOLDERS.includes(inner)) {
        issues.push(issue(text, i, `unknown placeholder \${${inner}}`, context, inner));
      }
      i = close + 1;
      continue;
    }
    const m = next === undefined ? null : new RegExp(`^${IDENT.source}`).exec(text.slice(i + 1));
    if (!m) {
      issues.push(issue(text, i, "malformed dollar sign (write $$ for a literal dollar)", context));
      i += 1;
      continue;
    }
    if (!ALLOWED_PLACEHOLDERS.includes(m[0])) {
      issues.push(issue(text, i, `unknown placeholder $${m[0]}`, context, m[0]));
    }
    i += 1 + m[0].length;
  }
  return issues;
}

function issue(
  text: string,
  index: number,
  what: string,
  context: { file?: string; partial?: string },
  name?: string,
): StudioIssue {
  const before = text.slice(0, index);
  const line = before.split("\n").length;
  const column = index - (before.lastIndexOf("\n") + 1) + 1;
  const where = context.partial
    ? `partial "${context.partial}"`
    : context.file
      ? `file "${context.file}"`
      : "rendered prompt";
  return {
    severity: "error",
    message: `${where}: ${what} at line ${line}, column ${column}. Only $project and $cwd are allowed.`,
    partial: context.partial,
    file: context.file,
    field: name,
    line,
    column,
  };
}

/** Which partial (by stem) contributed a given placeholder name, if any. */
export function findPlaceholderProvenance(
  name: string,
  partials: Record<string, string>,
): string[] {
  const hits: string[] = [];
  const re = new RegExp(`\\$(?:\\{${name}\\}|${name}\\b)`);
  for (const [stem, source] of Object.entries(partials)) {
    // Strip escaped dollars so `$$name` never counts as a placeholder.
    if (re.test(source.replace(/\$\$/g, ""))) hits.push(stem);
  }
  return hits.sort();
}
