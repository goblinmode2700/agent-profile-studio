import Handlebars from "handlebars";

import type { StudioIssue } from "./types";

export interface RenderRequest {
  layout: string;
  partials: Record<string, string>;
  helpers?: Record<string, string>;
  input: Record<string, unknown>;
  /** For error messages. */
  file?: string;
}

export interface RenderResult {
  text: string;
  issues: StudioIssue[];
  ms: number;
}

const PARTIAL_RE = /\{\{>\s*([^\s}]+)/g;

/** Names the partials a single template references directly. */
export function referencedPartials(layout: string): string[] {
  const names = new Set<string>();
  for (const m of layout.matchAll(PARTIAL_RE)) names.add((m[1] ?? "").replace(/^["']|["']$/g, ""));
  return [...names];
}

/**
 * The full closure of partials a template needs: direct references plus every partial
 * those partials reference, and so on. Cycles are visited once.
 */
export function partialClosure(
  layout: string,
  available: Record<string, string>,
): { used: Record<string, string>; missing: string[] } {
  const used: Record<string, string> = {};
  const missing = new Set<string>();
  const queue = referencedPartials(layout);
  const seen = new Set<string>();
  while (queue.length) {
    const name = queue.shift()!;
    if (seen.has(name)) continue;
    seen.add(name);
    const source = available[name];
    if (source === undefined) {
      missing.add(name);
      continue;
    }
    used[name] = source;
    queue.push(...referencedPartials(source));
  }
  return { used, missing: [...missing].sort() };
}

export function renderTemplate(req: RenderRequest): RenderResult {
  const started = now();
  const issues: StudioIssue[] = [];
  const env = Handlebars.create();

  for (const [name, source] of Object.entries(req.helpers ?? {})) {
    try {
      const module_ = { exports: {} as unknown };
      // eslint-disable-next-line no-new-func
      const fn = new Function("Handlebars", "module", "exports", source);
      fn(env, module_, module_.exports);
      if (typeof module_.exports === "function") {
        (module_.exports as (h: typeof env) => void)(env);
      }
    } catch (error) {
      issues.push({
        severity: "error",
        file: `catalog/helpers/${name}.js`,
        message: `catalog/helpers/${name}.js: ${(error as Error).message}`,
      });
    }
  }

  for (const [name, source] of Object.entries(req.partials)) {
    env.registerPartial(name, source);
  }

  // Missing partials are reported transitively: a partial referenced by a partial counts.
  for (const name of partialClosure(req.layout, req.partials).missing) {
    issues.push({
      severity: "error",
      partial: name,
      file: req.file,
      message: `${req.file ? `${req.file}: ` : ""}missing partial "${name}" (expected catalog/prompt/${name}.hbs).`,
    });
  }

  if (issues.some((i) => i.severity === "error" && i.partial)) {
    return { text: "", issues, ms: now() - started };
  }

  try {
    const template = env.compile(req.layout, { noEscape: true, strict: false });
    const text = template(req.input);
    return { text, issues, ms: now() - started };
  } catch (error) {
    const err = error as Error & { lineNumber?: number; column?: number };
    issues.push({
      severity: "error",
      file: req.file,
      line: err.lineNumber,
      column: err.column,
      message: `${req.file ? `${req.file}: ` : ""}template error: ${err.message}`,
    });
    return { text: "", issues, ms: now() - started };
  }
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
