import { useEffect, useMemo, useRef, useState } from "react";
import { Search, FolderTree, Clock, Send, Layers } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useRequestStore } from "../store/useRequestStore";
import type { Collection, CollectionFolder, CollectionRequest } from "../types";

/**
 * Command palette opened with Cmd+P / Ctrl+P. Fuzzy-matches across:
 *
 * - All requests inside every collection (including nested folders)
 * - The last 50 entries of the history table
 * - The collection list itself (jump to a collection)
 * - The environment list (jump-activate an environment)
 *
 * Picking a collection request reuses `loadRequestFromCollection` so auth
 * inheritance still walks the tree. Picking a history entry calls
 * `openTab` directly (history entries are detached from any collection).
 */

interface SearchResult {
  id: string;
  /** Visible label rendered in the row. */
  label: string;
  /** Smaller right-aligned hint (path / method+url / env name). */
  sub: string;
  /** Pre-lowercased haystack used by the matcher. */
  haystack: string;
  /** Icon used for the row. */
  kind: "request" | "history" | "collection" | "environment";
  /** Callback fired when the row is picked. */
  open: () => void;
}

function walkFolder(
  folder: CollectionFolder,
  trail: string[],
  out: SearchResult[],
  collection: Collection,
  loadRequest: (cid: string, rid: string) => void,
) {
  for (const req of folder.requests) {
    pushRequest(req, [...trail, folder.name], out, collection, loadRequest);
  }
  for (const sub of folder.folders) {
    walkFolder(sub, [...trail, folder.name], out, collection, loadRequest);
  }
}

function pushRequest(
  req: CollectionRequest,
  trail: string[],
  out: SearchResult[],
  collection: Collection,
  loadRequest: (cid: string, rid: string) => void,
) {
  const path = [collection.name, ...trail].join(" / ");
  out.push({
    id: `req:${collection.id}:${req.id}`,
    label: req.name || req.url,
    sub: `${req.method.toUpperCase()}  ${path}`,
    haystack: `${req.name} ${req.url} ${req.method} ${path}`.toLowerCase(),
    kind: "request",
    open: () => loadRequest(collection.id, req.id),
  });
}

/**
 * Cheap fuzzy match: every character of the query must appear in the
 * haystack in order (case-insensitive). Score = inverse of total span.
 * Cheap because no allocation, no regex, no dependencies.
 */
function fuzzyScore(haystack: string, query: string): number {
  if (!query) return 1;
  let hi = 0;
  let firstIdx = -1;
  let lastIdx = -1;
  for (let qi = 0; qi < query.length; qi++) {
    const ch = query[qi];
    while (hi < haystack.length && haystack[hi] !== ch) hi++;
    if (hi === haystack.length) return 0;
    if (firstIdx === -1) firstIdx = hi;
    lastIdx = hi;
    hi++;
  }
  const span = (lastIdx - firstIdx) + 1;
  // Higher score = better. Bonus for starting near index 0.
  return 1000 / (span + firstIdx * 0.5 + 1);
}

interface Props {
  onClose: () => void;
}

export function SearchPalette({ onClose }: Props) {
  const { t } = useTranslation();
  const collections = useRequestStore((s) => s.collections);
  const history = useRequestStore((s) => s.history);
  const environments = useRequestStore((s) => s.environments);
  const workspace = useRequestStore((s) => s.workspace);

  const loadRequest = useRequestStore((s) => s.loadRequestFromCollection);
  const openTab = useRequestStore((s) => s.openTab);
  const setActiveEnvironment = useRequestStore((s) => s.setActiveEnvironment);

  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const all = useMemo<SearchResult[]>(() => {
    const out: SearchResult[] = [];

    for (const c of collections) {
      out.push({
        id: `col:${c.id}`,
        label: c.name,
        sub: t("palette.items_count", { count: c.requests.length + c.folders.length }),
        haystack: `${c.name} ${c.description}`.toLowerCase(),
        kind: "collection",
        open: () => {
          // Best-effort: opening the collection means opening its first
          // request. If empty, no-op.
          const first = c.requests[0];
          if (first) loadRequest(c.id, first.id);
        },
      });
      for (const req of c.requests) {
        pushRequest(req, [], out, c, loadRequest);
      }
      for (const folder of c.folders) {
        walkFolder(folder, [], out, c, loadRequest);
      }
    }

    for (const h of history.slice(0, 50)) {
      out.push({
        id: `hist:${h.id}`,
        label: h.name || h.url,
        sub: `${h.method.toUpperCase()}  ${h.url}`,
        haystack: `${h.name} ${h.url} ${h.method}`.toLowerCase(),
        kind: "history",
        open: () => openTab(h),
      });
    }

    for (const env of environments) {
      const isActive = workspace?.active_environment_id === env.id;
      out.push({
        id: `env:${env.id}`,
        label: env.name,
        sub: isActive ? t("palette.active") : t("palette.vars_count", { count: env.variables.length }),
        haystack: env.name.toLowerCase(),
        kind: "environment",
        open: () => setActiveEnvironment(env.id),
      });
    }

    return out;
  }, [collections, history, environments, workspace, loadRequest, openTab, setActiveEnvironment, t]);

  const ranked = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      // No query → show recents first.
      return all
        .map((r, i) => ({ r, s: r.kind === "history" ? 100 - i : 50 - i }))
        .sort((a, b) => b.s - a.s)
        .slice(0, 60)
        .map((x) => x.r);
    }
    return all
      .map((r) => ({ r, s: fuzzyScore(r.haystack, q) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 60)
      .map((x) => x.r);
  }, [all, query]);

  // Reset highlighted row when the query changes. Uses the React-recommended
  // "compare previous value during render" pattern to avoid an extra render.
  const [prevQuery, setPrevQuery] = useState(query);
  if (query !== prevQuery) {
    setPrevQuery(query);
    setActiveIdx(0);
  }

  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  const select = (r: SearchResult) => {
    r.open();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] bg-black/40 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-[640px] max-w-[90vw] bg-card rounded-xl shadow-lg overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Search size={16} className="text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIdx((i) => Math.min(i + 1, ranked.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIdx((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const r = ranked[activeIdx];
                if (r) select(r);
              }
            }}
            placeholder={t("palette.placeholder")}
            className="flex-1 bg-transparent text-[14px] text-foreground placeholder:text-muted-foreground outline-none border-0"
          />
          <kbd className="text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5">ESC</kbd>
        </div>
        <div ref={listRef} className="max-h-[60vh] overflow-y-auto">
          {ranked.length === 0 && (
            <div className="text-center py-10 text-[12px] text-muted-foreground">
              {t("palette.no_matches")}
            </div>
          )}
          {ranked.map((r, i) => {
            const active = i === activeIdx;
            const Icon =
              r.kind === "request" ? Send
                : r.kind === "history" ? Clock
                : r.kind === "collection" ? FolderTree
                : Layers;
            return (
              <div
                key={r.id}
                data-idx={i}
                onMouseEnter={() => setActiveIdx(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  select(r);
                }}
                className={`flex items-center gap-3 px-4 py-2 cursor-pointer ${
                  active ? "bg-primary/10" : ""
                }`}
              >
                <Icon size={14} className={active ? "text-primary" : "text-muted-foreground"} />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] text-foreground truncate">{r.label}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{r.sub}</div>
                </div>
                <span className="text-[10px] uppercase text-muted-foreground opacity-60">
                  {t(`palette.kind_${r.kind}` as const)}
                </span>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-3 px-4 py-2 border-t border-border text-[10px] text-muted-foreground">
          <span>↑↓ {t("palette.navigate")}</span>
          <span>↵ {t("palette.open")}</span>
          <span>esc {t("palette.close")}</span>
        </div>
      </div>
    </div>
  );
}
