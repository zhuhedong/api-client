import { useMemo, useRef, useState, useEffect } from "react";
import { ChevronRight } from "lucide-react";

/**
 * Dependency-free virtualized JSON tree. The project can't pull
 * `@tanstack/react-virtual` (offline), so this hand-rolls windowing: the JSON
 * is flattened to a flat list of visible lines (respecting expand/collapse),
 * and only the rows intersecting the scroll viewport are rendered, with a
 * spacer sizing the scrollbar. Keeps large responses (10k+ nodes) smooth where
 * `react-json-view-lite` froze on expand.
 *
 * Colors mirror the inline `highlightJson` highlighter: keys = primary,
 * strings = success, numbers = purple, booleans/null = orange.
 */

const ROW_H = 20; // px — fixed row height is what makes the windowing math cheap.
const OVERSCAN = 8;
const MAX_VIEWPORT_CLASS = "max-h-[70vh]";

type Json = unknown;

interface FlatLine {
  id: string;
  depth: number;
  /** Object key or array index label; undefined for the root. */
  keyText?: string;
  keyIsIndex?: boolean;
  kind: "primitive" | "open" | "close" | "collapsed";
  bracket?: string;
  /** Rendered primitive text (already quoted for strings). */
  value?: string;
  valueClass?: string;
  /** Child count for a collapsed container. */
  count?: number;
  trailingComma?: boolean;
}

function valueClassFor(v: Json): string {
  if (typeof v === "string") return "text-success";
  if (typeof v === "number") return "text-purple";
  if (typeof v === "boolean" || v === null) return "text-orange";
  return "text-foreground";
}

function renderPrimitive(v: Json): string {
  if (typeof v === "string") return JSON.stringify(v); // quotes + escapes
  if (v === null) return "null";
  return String(v);
}

/** Collect container paths to expand by default (top `maxDepth` levels), so the
 *  initial view matches the old `shouldExpandNode={(level) => level < 2}`. */
function collectExpanded(data: Json, maxDepth: number): Set<string> {
  const out = new Set<string>();
  const walk = (value: Json, path: string, depth: number) => {
    if (!value || typeof value !== "object") return;
    if (depth < maxDepth) out.add(path);
    const entries = Array.isArray(value)
      ? value.map((v, i) => [String(i), v] as const)
      : Object.entries(value as Record<string, Json>);
    for (const [k, v] of entries) walk(v, `${path}.${k}`, depth + 1);
  };
  walk(data, "$", 0);
  return out;
}

/** Flatten JSON into the list of visible lines given the expanded set. */
function flatten(data: Json, expanded: Set<string>): FlatLine[] {
  const lines: FlatLine[] = [];
  const walk = (
    value: Json,
    path: string,
    depth: number,
    keyText: string | undefined,
    keyIsIndex: boolean,
    isLast: boolean,
  ) => {
    const isObj = value !== null && typeof value === "object";
    if (!isObj) {
      lines.push({
        id: path,
        depth,
        keyText,
        keyIsIndex,
        kind: "primitive",
        value: renderPrimitive(value),
        valueClass: valueClassFor(value),
        trailingComma: !isLast,
      });
      return;
    }
    const isArray = Array.isArray(value);
    const open = isArray ? "[" : "{";
    const close = isArray ? "]" : "}";
    const entries = isArray
      ? (value as Json[]).map((v, i) => [String(i), v] as const)
      : Object.entries(value as Record<string, Json>);

    if (!expanded.has(path)) {
      lines.push({
        id: path,
        depth,
        keyText,
        keyIsIndex,
        kind: "collapsed",
        bracket: open + close,
        count: entries.length,
        trailingComma: !isLast,
      });
      return;
    }
    lines.push({ id: path, depth, keyText, keyIsIndex, kind: "open", bracket: open });
    entries.forEach(([k, v], i) =>
      walk(v, `${path}.${k}`, depth + 1, k, isArray, i === entries.length - 1),
    );
    lines.push({
      id: `${path}::close`,
      depth,
      kind: "close",
      bracket: close,
      trailingComma: !isLast,
    });
  };
  walk(data, "$", 0, undefined, false, true);
  return lines;
}

function LineRow({
  line,
  isOpen,
  onToggle,
}: {
  line: FlatLine;
  isOpen: boolean;
  onToggle: (id: string) => void;
}) {
  const expandable = line.kind === "open" || line.kind === "collapsed";
  return (
    <div
      className="flex items-center whitespace-pre"
      style={{ height: ROW_H, paddingLeft: 4 + line.depth * 14 }}
    >
      {expandable ? (
        <button
          type="button"
          onClick={() => onToggle(line.id)}
          className="mr-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
        >
          <ChevronRight
            size={11}
            className={`transition-transform ${isOpen ? "rotate-90" : ""}`}
          />
        </button>
      ) : (
        <span className="mr-0.5 inline-block h-3.5 w-3.5 shrink-0" />
      )}
      {line.keyText !== undefined && (
        <>
          <span className={line.keyIsIndex ? "text-muted-foreground" : "text-primary"}>
            {line.keyIsIndex ? line.keyText : `"${line.keyText}"`}
          </span>
          <span className="text-muted-foreground">: </span>
        </>
      )}
      {line.kind === "primitive" && (
        <span className={line.valueClass}>{line.value}</span>
      )}
      {line.kind === "open" && (
        <span className="text-muted-foreground">{line.bracket}</span>
      )}
      {line.kind === "close" && (
        <span className="text-muted-foreground">{line.bracket}</span>
      )}
      {line.kind === "collapsed" && (
        <span className="text-muted-foreground">
          {line.bracket?.[0]} … {line.bracket?.[1]}
          <span className="ml-1 opacity-60">{line.count}</span>
        </span>
      )}
      {line.trailingComma && <span className="text-muted-foreground">,</span>}
    </div>
  );
}

export function VirtualJsonTree({
  data,
  className,
}: {
  data: Json;
  className?: string;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    collectExpanded(data, 2),
  );
  // Re-seed expansion when the response data changes (prev-value-during-render).
  const [prevData, setPrevData] = useState(data);
  if (data !== prevData) {
    setPrevData(data);
    setExpanded(collectExpanded(data, 2));
  }

  const lines = useMemo(() => flatten(data, expanded), [data, expanded]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(480);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setViewportH(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const total = lines.length;
  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const end = Math.min(total, Math.ceil((scrollTop + viewportH) / ROW_H) + OVERSCAN);
  const visible = lines.slice(start, end);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div
      ref={scrollRef}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      className={`overflow-auto font-mono text-[12px] leading-[1.65] ${MAX_VIEWPORT_CLASS} ${className ?? ""}`}
    >
      <div style={{ height: total * ROW_H, position: "relative" }}>
        <div style={{ transform: `translateY(${start * ROW_H}px)` }}>
          {visible.map((line) => (
            <LineRow
              key={line.id}
              line={line}
              isOpen={line.kind === "open"}
              onToggle={toggle}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
