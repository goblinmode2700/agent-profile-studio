import { StreamLanguage, type StringStream } from "@codemirror/language";

/**
 * A CodeMirror stream mode for Handlebars templates.
 *
 * Handlebars only: mustache expressions `{{ }}`, `{{{ }}}`, block helpers
 * `{{#if}}`/`{{/if}}`, partials `{{> name}}`, comments `{{! }}` and `{{!-- --}}`.
 * Text outside a mustache is plain prompt text, except that `$name` / `${name}` are
 * marked so launcher placeholders stand out.
 */

interface HbState {
  inExpr: boolean;
  depth: number;
  inComment: boolean;
  awaitingName: boolean;
}

const KEYWORDS = new Set([
  "if",
  "unless",
  "each",
  "with",
  "else",
  "log",
  "lookup",
  "in",
  "this",
  "true",
  "false",
  "null",
  "undefined",
]);

const handlebarsMode = {
  name: "handlebars",

  startState(): HbState {
    return { inExpr: false, depth: 0, inComment: false, awaitingName: false };
  },

  token(stream: StringStream, state: HbState): string | null {
    if (state.inComment) {
      if (stream.match(/^[\s\S]*?--\}\}/)) {
        state.inComment = false;
      } else {
        stream.skipToEnd();
      }
      return "comment";
    }

    if (!state.inExpr) {
      if (stream.match(/^\{\{!--/)) {
        state.inComment = true;
        return "comment";
      }
      if (stream.match(/^\{\{![^}]*\}\}/)) return "comment";
      if (stream.match(/^\{\{\{?/)) {
        state.inExpr = true;
        state.awaitingName = true;
        return "bracket";
      }
      // Launcher placeholders in plain text.
      if (stream.match(/^\$\$/)) return "escape";
      if (stream.match(/^\$\{[A-Za-z_][A-Za-z0-9_]*\}/)) return "atom";
      if (stream.match(/^\$[A-Za-z_][A-Za-z0-9_]*/)) return "atom";
      if (stream.match(/^[^{$]+/)) return null;
      stream.next();
      return null;
    }

    // Inside a mustache expression.
    if (stream.match(/^\}\}\}?/)) {
      state.inExpr = false;
      state.awaitingName = false;
      return "bracket";
    }
    if (stream.eatSpace()) return null;
    if (state.awaitingName) {
      state.awaitingName = false;
      if (stream.match(/^[>](\s*)/)) return "keyword"; // partial call
      if (stream.match(/^[#/^]/)) return "keyword"; // block open / close / inverse
      if (stream.match(/^&/)) return "keyword";
    }
    if (stream.match(/^"(?:[^"\\]|\\.)*"|^'(?:[^'\\]|\\.)*'/)) return "string";
    if (stream.match(/^-?\d+(?:\.\d+)?/)) return "number";
    if (stream.match(/^@[A-Za-z_][\w.-]*/)) return "meta"; // @index, @key, @root
    if (stream.match(/^[A-Za-z_$][\w.\-/[\]]*/)) {
      const word = stream.current().split(/[.[]/)[0] ?? "";
      return KEYWORDS.has(word) ? "keyword" : "variableName";
    }
    if (stream.match(/^[=|]/)) return "operator";
    stream.next();
    return null;
  },
};

export const handlebarsLanguage = StreamLanguage.define<HbState>(handlebarsMode);
