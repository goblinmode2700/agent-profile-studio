import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { yaml } from "@codemirror/lang-yaml";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import CodeMirror from "@uiw/react-codemirror";
import { useMemo } from "react";

import { handlebarsLanguage } from "@/lib/handlebars-mode";
import { cn } from "@/lib/utils";

export type EditorLanguage = "handlebars" | "yaml" | "json" | "javascript" | "text";

const theme = EditorView.theme(
  {
    "&, &.cm-editor, & .cm-scroller": { backgroundColor: "transparent", color: "var(--color-foreground)", fontSize: "12.5px" },
    ".cm-content": { fontFamily: "var(--font-mono)", padding: "8px 0" },
    ".cm-gutters": {
      backgroundColor: "transparent",
      color: "var(--color-muted-foreground)",
      border: "none",
      fontFamily: "var(--font-mono)",
    },
    ".cm-activeLine": { backgroundColor: "color-mix(in oklab, var(--color-accent) 25%, transparent)" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--color-foreground)" },
    ".cm-cursor": { borderLeftColor: "var(--color-primary)" },
    ".cm-selectionBackground, ::selection": {
      backgroundColor: "color-mix(in oklab, var(--color-primary) 30%, transparent) !important",
    },
    ".cm-scroller": { lineHeight: "1.55" },
    ".cm-placeholder": { color: "var(--color-muted-foreground)" },
  },
  { dark: true },
);

/** One highlight palette for every mode, built from the design tokens. */
const highlight = HighlightStyle.define(
  [
    { tag: t.comment, color: "var(--color-muted-foreground)", fontStyle: "italic" },
    { tag: t.bracket, color: "var(--color-primary)" },
    { tag: t.keyword, color: "var(--color-chart-2)", fontWeight: "500" },
    { tag: t.variableName, color: "var(--color-foreground)" },
    { tag: t.propertyName, color: "var(--color-chart-2)" },
    { tag: t.string, color: "var(--color-chart-3)" },
    { tag: t.number, color: "var(--color-chart-3)" },
    { tag: t.bool, color: "var(--color-chart-2)" },
    { tag: t.null, color: "var(--color-chart-2)" },
    { tag: t.atom, color: "var(--color-chart-4)", fontWeight: "500" },
    { tag: t.escape, color: "var(--color-chart-4)" },
    { tag: t.meta, color: "var(--color-chart-4)" },
    { tag: t.operator, color: "var(--color-muted-foreground)" },
    { tag: t.punctuation, color: "var(--color-muted-foreground)" },
    { tag: t.definition(t.variableName), color: "var(--color-primary)" },
    { tag: t.content, color: "var(--color-chart-3)" },
    { tag: t.literal, color: "var(--color-chart-3)" },
    { tag: t.name, color: "var(--color-chart-2)" },
    { tag: t.typeName, color: "var(--color-chart-2)" },
    { tag: t.attributeName, color: "var(--color-chart-2)" },
    { tag: t.attributeValue, color: "var(--color-chart-3)" },
  ],
  { themeType: "dark" },
);

export function CodeEditor({
  value,
  onChange,
  language = "text",
  readOnly = false,
  height = "100%",
  className,
  placeholder,
}: {
  value: string;
  onChange?: (next: string) => void;
  language?: EditorLanguage;
  readOnly?: boolean;
  height?: string;
  className?: string;
  placeholder?: string;
}) {
  const extensions = useMemo(() => {
    const base = [Prec.highest(theme), Prec.highest(syntaxHighlighting(highlight))];
    switch (language) {
      case "yaml":
        return [yaml(), ...base];
      case "json":
        return [json(), ...base];
      case "javascript":
        return [javascript(), ...base];
      case "handlebars":
        return [handlebarsLanguage, ...base];
      default:
        return base;
    }
  }, [language]);

  return (
    <CodeMirror
      value={value}
      height={height}
      readOnly={readOnly}
      {...(placeholder ? { placeholder } : {})}
      basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: !readOnly }}
      extensions={extensions}
      {...(onChange ? { onChange } : {})}
      className={cn("h-full overflow-auto bg-card font-mono text-xs", className)}
    />
  );
}
