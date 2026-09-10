import { parseDocument, stringify, type Document } from "yaml";

import type { StudioIssue } from "./types";

export interface ParsedYaml<T> {
  value: T | null;
  issues: StudioIssue[];
  doc: Document.Parsed | null;
}

/** Parse YAML, reporting the file and the line of any syntax error. */
export function parseYaml<T = Record<string, unknown>>(text: string, file: string): ParsedYaml<T> {
  const issues: StudioIssue[] = [];
  if (text.trim() === "") return { value: null, issues, doc: null };
  let doc: Document.Parsed | null = null;
  try {
    doc = parseDocument(text, { prettyErrors: true });
    for (const err of doc.errors) {
      issues.push({
        severity: "error",
        file,
        line: err.linePos?.[0]?.line,
        column: err.linePos?.[0]?.col,
        message: `${file}: YAML error at line ${err.linePos?.[0]?.line ?? "?"}: ${err.message}`,
      });
    }
    if (issues.length) return { value: null, issues, doc };
    return { value: doc.toJS() as T, issues, doc };
  } catch (error) {
    issues.push({ severity: "error", file, message: `${file}: ${(error as Error).message}` });
    return { value: null, issues, doc };
  }
}

export function toYaml(value: unknown): string {
  if (value == null) return "";
  return stringify(value, { lineWidth: 0 });
}
