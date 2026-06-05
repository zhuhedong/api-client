import { useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { javascript } from "@codemirror/lang-javascript";
import { xml } from "@codemirror/lang-xml";
import { html } from "@codemirror/lang-html";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";
import { autocompletion, type CompletionContext } from "@codemirror/autocomplete";
import { useDarkMode } from "../utils/useDarkMode";
import type { CodeEditorProps, CodeLanguage } from "./CodeEditor";

/** Match the surrounding monospaced UI: small font, comfortable line height. */
const baseExtensions = [
  EditorView.theme({
    "&": { fontSize: "12px" },
    ".cm-content": { fontFamily: "ui-monospace, SFMono-Regular, monospace", lineHeight: "1.55" },
    ".cm-gutters": { backgroundColor: "transparent", border: "none" },
    ".cm-line": { padding: "0 4px" },
  }),
  EditorView.lineWrapping,
];

function langExtension(language: CodeLanguage) {
  switch (language) {
    case "json":
      return [json()];
    case "javascript":
      return [javascript()];
    case "xml":
      return [xml()];
    case "html":
      return [html()];
    case "graphql":
      // Stock CodeMirror 6 doesn't include a graphql language module; use
      // javascript() as a close-enough fallback (braces, strings, comments).
      return [javascript()];
    case "plain":
      return [];
  }
}

/** Combined completion source: `{{variable}}` suggestions after `{{`, plus
 *  (when a GraphQL schema was fetched) flat type/field-name completion on bare
 *  identifiers. The GraphQL side is best-effort — name matching, not
 *  grammar-aware — since `codemirror-graphql` can't be pulled offline. */
function buildCompletionSource(vars: string[], graphqlFields?: string[]) {
  return (context: CompletionContext) => {
    const before = context.matchBefore(/\{\{[\w$.-]*/);
    if (before) {
      if (before.from === before.to && !context.explicit) return null;
      const typed = before.text.slice(2).toLowerCase();
      const matches = vars.filter((n) => n.toLowerCase().includes(typed));
      if (matches.length === 0) return null;
      // Avoid emitting a second `}}` when the cursor already sits before one.
      const after = context.state.sliceDoc(context.pos, context.pos + 2);
      const closing = after === "}}" ? "" : "}}";
      return {
        from: before.from + 2, // keep the leading "{{"
        to: context.pos,
        options: matches.map((name) => ({
          label: name,
          type: "variable",
          apply: name + closing,
        })),
      };
    }
    if (graphqlFields && graphqlFields.length > 0) {
      const word = context.matchBefore(/[A-Za-z_][A-Za-z0-9_]*$/);
      if (!word || (word.from === word.to && !context.explicit)) return null;
      const typed = word.text.toLowerCase();
      const matches = graphqlFields
        .filter((f) => f.toLowerCase().includes(typed))
        .slice(0, 50);
      if (matches.length === 0) return null;
      return {
        from: word.from,
        options: matches.map((name) => ({ label: name, type: "property" })),
      };
    }
    return null;
  };
}

/**
 * Concrete CodeMirror 6 implementation. Imported lazily by `CodeEditor`
 * so the ~600 kB CodeMirror chunk is split out of the initial bundle.
 *
 * - Theme follows the app's dark / light mode via `useDarkMode`.
 * - Gutter / line numbers default on; disable via `showGutter={false}` for
 *   compact one-line fields.
 * - `height="auto"` makes the editor grow with content (with a sensible min).
 */
export default function CodeEditorImpl({
  value,
  onChange,
  language,
  height = 220,
  showGutter = true,
  placeholder,
  readOnly = false,
  autoFocus = false,
  className,
  completions,
  graphqlFields,
}: CodeEditorProps) {
  const isDark = useDarkMode();
  const extensions = useMemo(() => {
    const exts = [...baseExtensions, ...langExtension(language)];
    if (
      (completions && completions.length > 0) ||
      (graphqlFields && graphqlFields.length > 0)
    ) {
      exts.push(
        autocompletion({
          override: [buildCompletionSource(completions ?? [], graphqlFields)],
        }),
      );
    }
    return exts;
  }, [language, completions, graphqlFields]);

  const containerStyle =
    height === "auto"
      ? { minHeight: 80 }
      : { height: typeof height === "number" ? `${height}px` : height };

  return (
    <div
      style={containerStyle}
      className={`rounded-lg border border-border overflow-hidden bg-card ${className ?? ""}`}
    >
      <CodeMirror
        value={value}
        onChange={onChange}
        extensions={extensions}
        theme={isDark ? oneDark : undefined}
        height={height === "auto" ? undefined : `${height}px`}
        basicSetup={{
          lineNumbers: showGutter,
          foldGutter: showGutter,
          highlightActiveLine: !readOnly,
          highlightActiveLineGutter: !readOnly,
          autocompletion: !readOnly,
          tabSize: 2,
        }}
        placeholder={placeholder}
        editable={!readOnly}
        autoFocus={autoFocus}
      />
    </div>
  );
}
