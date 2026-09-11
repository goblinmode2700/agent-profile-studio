import { isSeq, LineCounter, parseDocument, stringify, type Document, type Node } from "yaml";

import type { StudioIssue } from "./types";

export interface ParsedYaml<T> {
  value: T | null;
  issues: StudioIssue[];
  doc: Document.Parsed | null;
  lineCounter: LineCounter | null;
}

/** Parse YAML, reporting the file and the line of any syntax error. */
export function parseYaml<T = Record<string, unknown>>(text: string, file: string): ParsedYaml<T> {
  const issues: StudioIssue[] = [];
  if (text.trim() === "") return { value: null, issues, doc: null, lineCounter: null };
  let doc: Document.Parsed | null = null;
  const lineCounter = new LineCounter();
  try {
    doc = parseDocument(text, { prettyErrors: true, lineCounter });
    for (const err of doc.errors) {
      issues.push({
        severity: "error",
        file,
        line: err.linePos?.[0]?.line,
        column: err.linePos?.[0]?.col,
        message: `${file}: YAML error at line ${err.linePos?.[0]?.line ?? "?"}: ${err.message}`,
      });
    }
    if (issues.length) return { value: null, issues, doc, lineCounter };
    return { value: doc.toJS() as T, issues, doc, lineCounter };
  } catch (error) {
    issues.push({ severity: "error", file, message: `${file}: ${(error as Error).message}` });
    return { value: null, issues, doc, lineCounter };
  }
}

/** Locate a parsed YAML node without maintaining a second YAML parser. */
export function yamlNodePosition(
  parsed: Pick<ParsedYaml<unknown>, "doc" | "lineCounter">,
  path: Array<string | number>,
): { line?: number; column?: number } {
  const node = parsed.doc?.getIn(path, true) as Node | undefined;
  const offset = node?.range?.[0];
  if (offset == null || !parsed.lineCounter) return {};
  const pos = parsed.lineCounter.linePos(offset);
  return { line: pos.line, column: pos.col };
}

export function toYaml(value: unknown): string {
  if (value == null) return "";
  return stringify(value, { lineWidth: 0 });
}

/** Update one value in the existing YAML Document so untouched presentation survives. */
export function updateYamlPath(
  text: string,
  file: string,
  path: Array<string | number>,
  value: unknown,
): { text: string; issues: StudioIssue[] } {
  const parsed = parseYaml(text, file);
  if (!parsed.doc || parsed.issues.length) return { text, issues: parsed.issues };
  if (value === undefined) parsed.doc.deleteIn(path);
  else {
    const existing = parsed.doc.getIn(path, true);
    if (Array.isArray(value) && isSeq(existing)) {
      const reusable = [...existing.items];
      existing.items = value.map((item) => {
        const index = reusable.findIndex(
          (node) => (node as { toJSON(): unknown } | null)?.toJSON() === item,
        );
        if (index >= 0) return reusable.splice(index, 1)[0]!;
        return parsed.doc!.createNode(item);
      });
    } else parsed.doc.setIn(path, value);
  }
  return { text: parsed.doc.toString({ lineWidth: 0 }), issues: [] };
}
