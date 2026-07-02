import { lazy, Suspense } from "react";

export type CodeLanguage = "json" | "javascript" | "xml" | "html" | "graphql" | "plain";

export interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language: CodeLanguage;
  /** Pixel height of the editor. Pass "auto" to size to content (with a
   *  reasonable min). */
  height?: number | "auto";
  /** Whether to render line numbers and gutter; defaults to true. */
  showGutter?: boolean;
  placeholder?: string;
  readOnly?: boolean;
  autoFocus?: boolean;
  className?: string;
  /** Variable names offered as `{{name}}` autocompletions while typing after
   *  `{{`. Pass the resolved scope keys; an empty/omitted list disables it. */
  completions?: string[];
  /** GraphQL schema identifiers (type / field names) offered as completions in
   *  a graphql editor. Best-effort flat name matching, not grammar-aware. */
  graphqlFields?: string[];
  /** When true, renders a drag handle below the editor so the user can resize
   *  it. The initial height comes from `height`; pass `onHeightChange` to keep
   *  the chosen height in sync with a parent-controlled `height` (so it
   *  survives remounts). */
  resizable?: boolean;
  /** Minimum pixel height enforced while dragging. Defaults to 80. */
  minHeight?: number;
  /** Maximum pixel height enforced while dragging. Defaults to 800. */
  maxHeight?: number;
  /** Notified on every drag tick with the new pixel height. Use to lift the
   *  height into parent state (controlled) so it persists across remounts. */
  onHeightChange?: (px: number) => void;
}

// CodeMirror + language modes weigh in around ~600 kB minified. Lazy-load
// the actual editor so first paint and small UI (sidebar, list views)
// don't pay the cost. Until the chunk loads we render a plain textarea
// fallback that preserves the user's value so quick edits still work.
const LazyEditor = lazy(() => import("./CodeEditorImpl"));

function Fallback(props: CodeEditorProps) {
  const { value, onChange, height, placeholder, readOnly, autoFocus, className } = props;
  const style =
    height === "auto"
      ? { minHeight: 80 }
      : { height: typeof height === "number" ? `${height}px` : height };
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      readOnly={readOnly}
      autoFocus={autoFocus}
      placeholder={placeholder}
      spellCheck={false}
      style={style}
      className={`w-full rounded-lg border border-border bg-card px-2 py-1.5 font-mono text-[12px] leading-relaxed resize-none focus:outline-none ${className ?? ""}`}
    />
  );
}

/** Public CodeEditor entry point: a `Suspense` boundary around the real
 *  CodeMirror implementation, with a `textarea` fallback while the
 *  CodeMirror chunk is loading. */
export function CodeEditor(props: CodeEditorProps) {
  return (
    <Suspense fallback={<Fallback {...props} />}>
      <LazyEditor {...props} />
    </Suspense>
  );
}
