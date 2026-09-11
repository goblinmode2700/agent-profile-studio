import { DepGraph, DepGraphCycleError } from "dependency-graph";
import Handlebars from "handlebars";

import type { StudioIssue } from "./types";

export interface PromptContribution { name: string; source: string; file: string }
export interface RenderRequest {
  layout: string;
  partials: Record<string, string>;
  partialPaths?: Record<string, string> | undefined;
  helpers?: Record<string, string>;
  helperPaths?: Record<string, string> | undefined;
  contributions?: PromptContribution[];
  input: Record<string, unknown>;
  file?: string;
}
export interface RenderResult { text: string; issues: StudioIssue[]; ms: number }

const MAX_TEMPLATE_DEPTH = 64;
const ROOT = "layout";

interface TemplateAnalysis {
  partials: string[];
  fragmentPromptsCalls: number;
  unsupported?: { message: string; line?: number | undefined; column?: number | undefined } | undefined;
}

/** Analyze supported static partials with Handlebars' own parser. */
export function analyzeTemplate(source: string): TemplateAnalysis {
  const partials = new Set<string>();
  let fragmentPromptsCalls = 0;
  let unsupported: TemplateAnalysis["unsupported"];
  const ast = Handlebars.parse(source) as unknown as Record<string, unknown>;
  const stack: unknown[] = [ast];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    const record = node as Record<string, unknown>;
    const type = record["type"];
    if (type === "PartialStatement" || type === "PartialBlockStatement") {
      const name = record["name"] as Record<string, unknown> | undefined;
      if (type === "PartialBlockStatement" || name?.["type"] !== "PathExpression") {
        const loc = record["loc"] as { start?: { line?: number; column?: number } } | undefined;
        unsupported ??= {
          message: "unsupported dynamic or block partial; only static {{> name}} references are supported",
          line: loc?.start?.line,
          column: loc?.start?.column == null ? undefined : loc.start.column + 1,
        };
      } else partials.add(String(name["original"]));
    }
    if (type === "MustacheStatement") {
      const path = record["path"] as Record<string, unknown> | undefined;
      if (path?.["type"] === "PathExpression" && path["original"] === "fragmentPrompts") {
        fragmentPromptsCalls += 1;
      }
    }
    for (const value of Object.values(record)) {
      if (Array.isArray(value)) stack.push(...value);
      else if (value && typeof value === "object") stack.push(value);
    }
  }
  return { partials: [...partials], fragmentPromptsCalls, unsupported };
}

export function referencedPartials(layout: string): string[] {
  try { return analyzeTemplate(layout).partials; } catch { return []; }
}

interface GraphResult {
  used: Record<string, string>;
  missing: string[];
  issues: StudioIssue[];
  layoutCalls: number;
}

function dependencyGraph(req: RenderRequest): GraphResult {
  const graph = new DepGraph<string>();
  const used: Record<string, string> = {};
  const missing = new Set<string>();
  const issues: StudioIssue[] = [];
  const contributionNodes = (req.contributions ?? []).map((c, i) => `fragment:${c.name}#${i + 1}`);
  const sources = new Map<string, { source: string; file: string | undefined }>();
  sources.set(ROOT, { source: req.layout, file: req.file });
  (req.contributions ?? []).forEach((c, i) => sources.set(contributionNodes[i]!, { source: c.source, file: c.file }));
  graph.addNode(ROOT, ROOT);
  for (const node of contributionNodes) graph.addNode(node, node);

  const queue = [ROOT, ...contributionNodes];
  const visited = new Set<string>();
  let layoutCalls = 0;
  while (queue.length) {
    const node = queue.shift()!;
    if (visited.has(node)) continue;
    visited.add(node);
    const info = sources.get(node)!;
    let analysis: TemplateAnalysis;
    try { analysis = analyzeTemplate(info.source); }
    catch (error) {
      const err = error as Error & { lineNumber?: number; column?: number };
      issues.push({ severity: "error", file: info.file, line: err.lineNumber, column: err.column,
        message: `${info.file ? `${info.file}: ` : ""}template parse error: ${err.message}` });
      continue;
    }
    if (node === ROOT) layoutCalls = analysis.fragmentPromptsCalls;
    if (analysis.unsupported) issues.push({ severity: "error", file: info.file,
      line: analysis.unsupported.line, column: analysis.unsupported.column,
      message: `${info.file ? `${info.file}: ` : ""}${analysis.unsupported.message}.` });
    if (node !== ROOT && analysis.fragmentPromptsCalls > 0) issues.push({ severity: "error", file: info.file,
      message: `${info.file}: fragmentPrompts is reserved for the profile layout; dependency path ${node} -> fragmentPrompts is not allowed.` });
    for (const partial of analysis.partials) {
      if (!graph.hasNode(partial)) graph.addNode(partial, partial);
      graph.addDependency(node, partial);
      const source = req.partials[partial];
      if (source === undefined) missing.add(partial);
      else {
        used[partial] = source;
        sources.set(partial, { source, file: req.partialPaths?.[partial] ?? `catalog/prompt/${partial}.hbs` });
        queue.push(partial);
      }
    }
  }

  for (const root of [ROOT, ...contributionNodes]) {
    try {
      const deps = graph.dependenciesOf(root);
      const stack = [{ node: root, depth: 0 }];
      const greatest = new Map<string, number>();
      let maxDepth = 0;
      while (stack.length) {
        const current = stack.pop()!;
        if ((greatest.get(current.node) ?? -1) >= current.depth) continue;
        greatest.set(current.node, current.depth);
        maxDepth = Math.max(maxDepth, current.depth);
        for (const child of graph.directDependenciesOf(current.node)) stack.push({ node: child, depth: current.depth + 1 });
      }
      if (maxDepth > MAX_TEMPLATE_DEPTH) issues.push({ severity: "error", file: sources.get(root)?.file,
        message: `${sources.get(root)?.file ?? root}: template dependency depth ${maxDepth} exceeds the supported limit of ${MAX_TEMPLATE_DEPTH}; rendering was not attempted.` });
      if (root !== ROOT) {
        for (const dep of deps) {
          if (analyzeTemplate(sources.get(dep)?.source ?? "").fragmentPromptsCalls > 0) {
            issues.push({ severity: "error", file: sources.get(dep)?.file,
              message: `${sources.get(dep)?.file}: fragmentPrompts is reserved for the profile layout; dependency path ${root} -> ${dep} -> fragmentPrompts is not allowed.` });
          }
        }
      }
    } catch (error) {
      const cycle = error instanceof DepGraphCycleError ? error.cyclePath : [];
      issues.push({ severity: "error", file: sources.get(root)?.file,
        message: `${sources.get(root)?.file ?? root}: partial dependency cycle: ${cycle.join(" -> ") || (error as Error).message}.` });
    }
  }
  return { used, missing: [...missing].sort(), issues, layoutCalls };
}

/** Compatibility wrapper around the one dependency graph implementation. */
export function partialClosure(layout: string, available: Record<string, string>) {
  const result = dependencyGraph({ layout, partials: available, input: {} });
  return { used: result.used, missing: result.missing };
}

export function renderTemplate(req: RenderRequest): RenderResult {
  const started = now();
  const issues: StudioIssue[] = [];
  const env = Handlebars.create();
  if (Object.prototype.hasOwnProperty.call(req.input, "fragmentPrompts")) issues.push({ severity: "error", file: req.file,
    field: "fragmentPrompts", message: `${req.file ?? "profile"}: render input name "fragmentPrompts" is reserved by the Studio.` });
  if (Object.prototype.hasOwnProperty.call(req.helpers ?? {}, "fragmentPrompts")) issues.push({ severity: "error",
    file: req.helperPaths?.["fragmentPrompts"] ?? "catalog/helpers/fragmentPrompts.js", field: "fragmentPrompts",
    message: `catalog helper name "fragmentPrompts" is reserved by the Studio.` });

  for (const [name, source] of Object.entries(req.helpers ?? {})) {
    try {
      const module_ = { exports: {} as unknown };
      // eslint-disable-next-line no-new-func
      const fn = new Function("Handlebars", "module", "exports", source);
      fn(env, module_, module_.exports);
      if (typeof module_.exports === "function") (module_.exports as (h: typeof env) => void)(env);
    } catch (error) {
      const file = req.helperPaths?.[name] ?? `catalog/helpers/${name}.js`;
      issues.push({ severity: "error", file, message: `${file}: ${(error as Error).message}` });
    }
  }

  const graph = dependencyGraph(req);
  issues.push(...graph.issues);
  for (const name of graph.missing) issues.push({ severity: "error", partial: name, file: req.file,
    message: `${req.file ? `${req.file}: ` : ""}missing partial "${name}" (expected ${req.partialPaths?.[name] ?? `catalog/prompt/${name}.hbs`}).` });
  if (issues.some((i) => i.severity === "error")) return { text: "", issues, ms: now() - started };
  for (const [name, source] of Object.entries(graph.used)) env.registerPartial(name, source);

  try {
    const rendered = (req.contributions ?? [])
      .map((c) => env.compile(c.source, { noEscape: true, strict: false })(req.input))
      .filter((text) => text !== "");
    const aggregate = rendered.join("\n\n");
    env.registerHelper("fragmentPrompts", () => new env.SafeString(aggregate));
    if (rendered.length > 0 && graph.layoutCalls === 0) issues.push({ severity: "warning", file: req.file,
      field: "fragmentPrompts", message: `${req.file ?? "profile"}: imported promptText contributions are not placed; add {{fragmentPrompts}} to the layout.` });
    const text = env.compile(req.layout, { noEscape: true, strict: false })(req.input);
    return { text, issues, ms: now() - started };
  } catch (error) {
    const err = error as Error & { lineNumber?: number; column?: number };
    issues.push({ severity: "error", file: req.file, line: err.lineNumber, column: err.column,
      message: `${req.file ? `${req.file}: ` : ""}template error: ${err.message}` });
    return { text: "", issues, ms: now() - started };
  }
}

function now(): number { return typeof performance !== "undefined" ? performance.now() : Date.now(); }
