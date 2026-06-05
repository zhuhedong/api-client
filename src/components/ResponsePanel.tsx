import { useState, useMemo, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Copy, Check, ArrowUpRight, Search, X, Download, AlertTriangle, FileQuestion, GitCompare, ListTree, FileCode2, Filter, MoreHorizontal, Link2, Terminal, Archive, Variable, ChevronUp, ChevronDown, Timer } from "lucide-react";
import { save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { VirtualJsonTree } from "./VirtualJsonTree";
import { useRequestStore } from "../store/useRequestStore";
import { ResponseDiffModal } from "./ResponseDiffModal";
import { evaluateJsonPath } from "../utils/jsonPath";
import { resolveRequestUrl } from "../utils/resolveUrl";
import { exportCurl } from "../utils/curl";
import { buildHarLog } from "../utils/har";
import { buildScopedVars } from "../utils/variableScope";
import { SaveToVariableModal } from "./SaveToVariableModal";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

type ResponseTab = "body" | "headers" | "tests";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getStatusStyle(status: number): string {
  if (status >= 200 && status < 300) return "text-success bg-success/10";
  if (status >= 300 && status < 400) return "text-teal bg-teal/10";
  if (status >= 400 && status < 500) return "text-orange bg-orange/10";
  return "text-destructive bg-destructive/10";
}

function tryFormatJson(str: string): string {
  try {
    return JSON.stringify(JSON.parse(str), null, 2);
  } catch {
    return str;
  }
}

// Lightweight JSON syntax highlighter (no external dependency)
function highlightJson(json: string): React.ReactNode[] {
  const lines = json.split("\n");
  return lines.map((line, i) => {
    const parts: React.ReactNode[] = [];
    const remaining = line;
    let key = 0;

    // Match JSON tokens
    const regex = /("(?:\\.|[^"\\])*")\s*(:)?|(\b(?:true|false|null)\b)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(remaining)) !== null) {
      // Text before match
      if (match.index > lastIndex) {
        parts.push(<span key={key++}>{remaining.slice(lastIndex, match.index)}</span>);
      }

      if (match[1] && match[2]) {
        // Key
        parts.push(<span key={key++} className="text-primary">{match[1]}</span>);
        parts.push(<span key={key++}>{match[2]}</span>);
      } else if (match[1]) {
        // String value
        parts.push(<span key={key++} className="text-success">{match[1]}</span>);
      } else if (match[3]) {
        // Boolean / null
        parts.push(<span key={key++} className="text-orange">{match[3]}</span>);
      } else if (match[4]) {
        // Number
        parts.push(<span key={key++} className="text-purple">{match[4]}</span>);
      }

      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < remaining.length) {
      parts.push(<span key={key++}>{remaining.slice(lastIndex)}</span>);
    }

    return (
      <div key={i} className="leading-[1.65]">
        {parts.length > 0 ? parts : " "}
      </div>
    );
  });
}

function isJson(str: string): boolean {
  try {
    JSON.parse(str);
    return true;
  } catch {
    return false;
  }
}

function extractMime(headers: Record<string, string>): string {
  const ct =
    headers["content-type"] ||
    headers["Content-Type"] ||
    Object.entries(headers).find(([k]) => k.toLowerCase() === "content-type")?.[1] ||
    "";
  return ct.split(";")[0].trim().toLowerCase();
}

function defaultFileName(url: string, mime: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop();
    if (last && last.includes(".")) return last;
  } catch {}
  const ext = mime.split("/")[1] || "bin";
  return `response.${ext.replace(/\+.*$/, "")}`;
}

/// Render the first N bytes of a base64-encoded body as a classic hex dump.
function hexDump(base64: string, maxBytes = 4096): string {
  let bytes: Uint8Array;
  try {
    const bin = atob(base64);
    bytes = new Uint8Array(Math.min(bin.length, maxBytes));
    for (let i = 0; i < bytes.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch {
    return "(invalid base64 body)";
  }
  const lines: string[] = [];
  for (let off = 0; off < bytes.length; off += 16) {
    const chunk = bytes.slice(off, off + 16);
    const hex = Array.from(chunk)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(" ")
      .padEnd(16 * 3 - 1, " ");
    const ascii = Array.from(chunk)
      .map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : "."))
      .join("");
    lines.push(`${off.toString(16).padStart(8, "0")}  ${hex}  ${ascii}`);
  }
  return lines.join("\n");
}

export function ResponsePanel() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<ResponseTab>("body");
  const [copied, setCopied] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [diffOpen, setDiffOpen] = useState(false);
  // Body view mode: raw pretty-printed text (default) or interactive JSON
  // tree. Only meaningful when the body is valid JSON; for everything else
  // we fall back to raw regardless of this setting.
  const [bodyView, setBodyView] = useState<"raw" | "tree">("raw");
  // JSONPath filter applied to the response body before display. Empty
  // string = show the whole document. Errors during evaluation are caught
  // and surfaced as a small inline message rather than crashing.
  const [jsonPath, setJsonPath] = useState("");
  const [jsonPathOpen, setJsonPathOpen] = useState(false);
  // “More actions” dropdown anchored to the kebab button. Toggled open
  // from the button itself and closed by outside-click / Escape so it
  // behaves like a native menu.
  const [moreOpen, setMoreOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const searchMatchRefs = useRef<Array<HTMLElement | null>>([]);
  const [activeSearchMatch, setActiveSearchMatch] = useState(0);
  const [saveVariableOpen, setSaveVariableOpen] = useState(false);
  // One-shot status banner shown briefly after a copy / save action so the
  // user gets non-blocking visual feedback. Each entry is { kind, text };
  // it auto-clears after 2 s via the timeout below.
  const [actionFlash, setActionFlash] = useState<string | null>(null);
  const { response, loading, error, activeRequest, testResults, scriptLogs, scriptError, responseHistory, environments, workspace, collections, profileTiming, setProfileTiming } = useRequestStore();
  const snapshots = activeRequest ? responseHistory[activeRequest.id] ?? [] : [];
  const canDiff = snapshots.length >= 2;

  const tests = activeRequest ? testResults[activeRequest.id] ?? null : null;
  const logs = activeRequest ? scriptLogs[activeRequest.id] ?? null : null;
  const sErr = activeRequest ? scriptError[activeRequest.id] ?? null : null;
  const passedCount = tests ? tests.filter((t) => t.passed).length : 0;
  const failedCount = tests ? tests.length - passedCount : 0;

  const isBinary = response?.body_encoding === "base64";
  const mime = useMemo(() => (response ? extractMime(response.headers) : ""), [response]);

  const formattedBody = useMemo(() => {
    if (!response?.body || isBinary) return "";
    return isJson(response.body) ? tryFormatJson(response.body) : response.body;
  }, [response, isBinary]);

  const bodyIsJson = useMemo(
    () => (response && !isBinary ? isJson(response.body) : false),
    [response, isBinary]
  );

  // Parsed JSON value for the tree view. Kept separate from `bodyIsJson`
  // so we don't pay the parse cost again if the user is just looking at
  // the raw body.
  const parsedJson = useMemo(() => {
    if (!bodyIsJson || !response?.body) return undefined;
    try {
      return JSON.parse(response.body) as unknown;
    } catch {
      return undefined;
    }
  }, [bodyIsJson, response]);

  // Result of applying the active JSONPath filter to the parsed JSON.
  // `error` is shown inline; `value` feeds both the tree view and (when
  // serialized) the raw view below.
  const jsonPathResult = useMemo<{ value: unknown; error: string | null }>(() => {
    if (!jsonPath.trim() || parsedJson === undefined) {
      return { value: parsedJson, error: null };
    }
    try {
      return { value: evaluateJsonPath(parsedJson, jsonPath), error: null };
    } catch (e) {
      return { value: undefined, error: e instanceof Error ? e.message : String(e) };
    }
  }, [jsonPath, parsedJson]);

  /** When the user has typed a JSONPath, render the filtered subtree
   *  (re-serialized) instead of the original body. Falls back to the
   *  original body when the path is empty or fails to evaluate. */
  const displayJson = jsonPath.trim() ? jsonPathResult.value : parsedJson;
  const displayBody = useMemo(() => {
    if (!jsonPath.trim()) return formattedBody;
    if (jsonPathResult.error) return formattedBody;
    if (jsonPathResult.value === undefined) return "(no match)";
    try {
      return JSON.stringify(jsonPathResult.value, null, 2);
    } catch {
      return String(jsonPathResult.value);
    }
  }, [jsonPath, jsonPathResult, formattedBody]);

  const searchMatchCount = useMemo(() => {
    if (!searchQuery || !displayBody) return 0;
    const query = searchQuery.toLowerCase();
    const source = displayBody.toLowerCase();
    let count = 0;
    let offset = 0;
    while (offset < source.length) {
      const idx = source.indexOf(query, offset);
      if (idx === -1) break;
      count += 1;
      offset = idx + query.length;
    }
    return count;
  }, [searchQuery, displayBody]);

  const currentSearchMatch =
    searchMatchCount === 0
      ? 0
      : Math.min(activeSearchMatch, searchMatchCount - 1);

  const highlightedSearchBody = useMemo(() => {
    if (!searchQuery || !displayBody) return null;
    const lines = displayBody.split("\n");
    let matchIndex = 0;
    return lines.map((line, i) => {
      if (!line.toLowerCase().includes(searchQuery.toLowerCase())) {
        return <div key={i} className="leading-[1.65]">{line || " "}</div>;
      }
      const parts: React.ReactNode[] = [];
      let remaining = line;
      const lowerQuery = searchQuery.toLowerCase();
      let key = 0;
      while (remaining.length > 0) {
        const idx = remaining.toLowerCase().indexOf(lowerQuery);
        if (idx === -1) {
          parts.push(<span key={key++}>{remaining}</span>);
          break;
        }
        if (idx > 0) parts.push(<span key={key++}>{remaining.slice(0, idx)}</span>);
        const currentMatchIndex = matchIndex++;
        const isActiveMatch = currentMatchIndex === currentSearchMatch;
        parts.push(
          <mark
            key={key++}
            ref={(el) => {
              searchMatchRefs.current[currentMatchIndex] = el;
            }}
            className={`${isActiveMatch ? "bg-warning text-foreground ring-1 ring-warning/60" : "bg-warning/40 text-foreground"} rounded-sm px-0.5`}
          >
            {remaining.slice(idx, idx + searchQuery.length)}
          </mark>
        );
        remaining = remaining.slice(idx + searchQuery.length);
      }
      return <div key={i} className="leading-[1.65]">{parts}</div>;
    });
  }, [searchQuery, displayBody, currentSearchMatch]);

  useEffect(() => {
    if (!searchOpen || activeTab !== "body" || !searchQuery || searchMatchCount === 0) return;
    searchMatchRefs.current[currentSearchMatch]?.scrollIntoView({ block: "center", inline: "nearest" });
  }, [activeTab, searchOpen, searchQuery, searchMatchCount, currentSearchMatch]);

  const goToSearchMatch = (direction: "previous" | "next") => {
    if (searchMatchCount === 0) return;
    setActiveSearchMatch((current) =>
      direction === "next"
        ? (current + 1) % searchMatchCount
        : (current - 1 + searchMatchCount) % searchMatchCount,
    );
  };

  const copyBody = async () => {
    if (response?.body) {
      await navigator.clipboard.writeText(response.body);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  /** Full scope chain (global → collection → folder → environment) used
   *  for URL / cURL / HAR exports. Mirrors what `requestPipeline` builds
   *  at send time — minus transient script overrides, which are already
   *  discarded by the time the user clicks Copy. Using the full chain
   *  keeps the three response-panel copy actions in lock-step with the
   *  request-panel "Copy as cURL" button, so a `{{var}}` defined at any
   *  layer resolves consistently regardless of which copy entry point the
   *  user used. */
  const envVars = useMemo<Record<string, string>>(
    () =>
      activeRequest
        ? buildScopedVars({
            workspace,
            collections,
            environments,
            request: activeRequest,
          })
        : {},
    [workspace, collections, environments, activeRequest],
  );

  const flash = (msg: string) => {
    setActionFlash(msg);
  };

  // Auto-clear the action flash banner after 2 s so it never lingers.
  useEffect(() => {
    if (!actionFlash) return;
    const t = setTimeout(() => setActionFlash(null), 2000);
    return () => clearTimeout(t);
  }, [actionFlash]);

  // Close the More menu on outside click / Escape so it behaves like a
  // native menu.
  useEffect(() => {
    if (!moreOpen) return;
    const onClick = (e: MouseEvent) => {
      if (
        moreMenuRef.current &&
        !moreMenuRef.current.contains(e.target as Node)
      ) {
        setMoreOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  const copyUrl = async () => {
    if (!activeRequest) return;
    const url = resolveRequestUrl(activeRequest, envVars);
    await navigator.clipboard.writeText(url);
    flash(t("response.copy_url"));
    setMoreOpen(false);
  };

  const copyAsCurl = async () => {
    if (!activeRequest) return;
    // Pass envVars so {{var}} placeholders in the URL / headers / body /
    // params are resolved against the active env — matches the behaviour
    // of Copy URL / Copy as HAR, so all three exports produce something
    // the user can immediately run / share.
    await navigator.clipboard.writeText(exportCurl(activeRequest, envVars));
    flash(t("response.copy_curl"));
    setMoreOpen(false);
  };

  const copyAsHar = async () => {
    if (!activeRequest || !response) return;
    const finalUrl = resolveRequestUrl(activeRequest, envVars);
    // Approximate start time: HAR requires a startedDateTime, and we don't
    // record one. `Date.now() - response.time_ms` is the closest we can
    // get without instrumenting the send pipeline.
    const startedAt = Date.now() - response.time_ms;
    const har = buildHarLog(activeRequest, response, finalUrl, startedAt);
    await navigator.clipboard.writeText(JSON.stringify(har, null, 2));
    flash(t("response.copy_har"));
    setMoreOpen(false);
  };

  const openSaveToVariable = () => {
    setMoreOpen(false);
    setSaveVariableOpen(true);
  };

  const saveResponseToDisk = async () => {
    if (!response) return;
    const suggested = defaultFileName(activeRequest?.url || "", mime);
    const path = await saveFileDialog({ defaultPath: suggested });
    if (!path) return;
    // When the body was truncated for display, ask the backend to write the
    // full cached bytes from the most recent send. Otherwise just write the
    // bytes we already have in the frontend.
    await invoke("save_response_to_file", {
      path,
      body: response.body,
      encoding: response.body_encoding,
      requestId: activeRequest?.id,
      useCached: response.body_truncated,
    });
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1500);
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-[13px] text-muted-foreground">Sending…</span>
        </div>
      </div>
    );
  }

  if (error) {
    const titleKey = `errors.kind.${error.kind}`;
    const fallbackTitle = t("response.request_failed");
    const title = t(titleKey, { defaultValue: fallbackTitle });
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="bg-destructive/5 rounded-lg p-4 max-w-md text-center">
          <p className="text-destructive font-medium text-[13px] mb-1">{title}</p>
          <p className="text-muted-foreground text-[12px] leading-relaxed mb-3">{error.message}</p>
          <p className="text-muted-foreground text-[10px] font-mono mb-3">{error.code}</p>
          {error.retryable && (
            <button
              type="button"
              onClick={() => void useRequestStore.getState().sendRequest()}
              className="px-3 py-1.5 rounded-lg bg-primary text-white text-[12px] font-medium hover:opacity-90 transition"
            >
              {t("response.retry")}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!response) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <ArrowUpRight size={32} className="mx-auto text-muted-foreground/50 mb-3" strokeWidth={1.5} />
          <p className="text-muted-foreground text-[13px]">{t("response.no_response")}</p>
          <p className="text-muted-foreground/70 text-[11px] mt-1.5">
            Press <kbd className="px-1.5 py-0.5 bg-muted rounded-md text-muted-foreground text-[10px] font-mono">⏎</kbd> to send
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* Status bar */}
      <div className="shrink-0 flex items-center gap-2.5 px-4 py-2.5 bg-card">
        <Badge
          variant="outline"
          className={cn(
            "rounded-md border-transparent px-2 py-[3px] text-[11px] font-semibold",
            getStatusStyle(response.status),
          )}
        >
          {response.status} {response.status_text}
        </Badge>
        <TimingPill timeMs={response.time_ms} timings={response.timings} />
        <span className="text-[11px] text-muted-foreground">·</span>
        <span className="text-[11px] text-muted-foreground">{formatSize(response.size_bytes)}</span>
        <button
          type="button"
          onClick={() => setProfileTiming(!profileTiming)}
          title="Measure DNS / TCP / TLS on the next send (opens a separate probe connection)"
          className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition-colors ${
            profileTiming
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:bg-accent"
          }`}
        >
          <Timer size={11} />
          Profile
        </button>

        <div className="ml-auto flex items-center gap-1">
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as ResponseTab)}
          >
            <TabsList className="h-8">
              <TabsTrigger value="body" className="text-[12px]">
                {t("response.body")}
              </TabsTrigger>
              <TabsTrigger value="headers" className="text-[12px]">
                {t("response.headers")}
                <span className="ml-1 text-[10px] text-muted-foreground">
                  {Object.keys(response.headers).length}
                </span>
              </TabsTrigger>
              {(tests !== null || sErr !== null || (logs && logs.length > 0)) && (
                <TabsTrigger value="tests" className="text-[12px]">
                  {t("response.tests")}
                  {tests && tests.length > 0 && (
                    <span
                      className={`ml-1 text-[10px] ${
                        failedCount > 0 ? "text-destructive" : "text-success"
                      }`}
                    >
                      {failedCount > 0
                        ? `${failedCount}/${tests.length} failed`
                        : `${passedCount}/${tests.length} passed`}
                    </span>
                  )}
                </TabsTrigger>
              )}
            </TabsList>
          </Tabs>
          {activeTab === "body" && bodyIsJson && (
            <>
              <button
                onClick={() => setJsonPathOpen((v) => !v)}
                className={`ml-1.5 w-7 h-7 flex items-center justify-center rounded-lg transition-colors ${jsonPathOpen || jsonPath ? "bg-primary/15" : "hover:bg-accent"}`}
                title="Filter response with JSONPath"
              >
                <Filter size={14} className={jsonPathOpen || jsonPath ? "text-primary" : "text-muted-foreground"} />
              </button>
              <button
                onClick={() => setBodyView((v) => (v === "raw" ? "tree" : "raw"))}
                className={`ml-1.5 w-7 h-7 flex items-center justify-center rounded-lg transition-colors ${bodyView === "tree" ? "bg-primary/15" : "hover:bg-accent"}`}
                title={bodyView === "tree" ? "Show raw JSON" : "Show JSON tree"}
              >
                {bodyView === "tree" ? (
                  <FileCode2 size={14} className="text-primary" />
                ) : (
                  <ListTree size={14} className="text-muted-foreground" />
                )}
              </button>
            </>
          )}
          <button
            onClick={() => setSearchOpen((s) => !s)}
            className={`ml-1.5 w-7 h-7 flex items-center justify-center rounded-lg transition-colors ${searchOpen ? "bg-primary/15" : "hover:bg-accent"}`}
            title={t("response.search_placeholder")}
          >
            <Search size={14} className={searchOpen ? "text-primary" : "text-muted-foreground"} />
          </button>
          <button
            onClick={() => setDiffOpen(true)}
            disabled={!canDiff}
            className={`w-7 h-7 flex items-center justify-center rounded-lg transition-colors ${canDiff ? "hover:bg-accent active:bg-accent" : "opacity-40 cursor-not-allowed"}`}
            title={canDiff ? `Compare with previous responses (${snapshots.length} captured)` : "Need 2+ responses to diff"}
          >
            <GitCompare size={14} className="text-muted-foreground" />
          </button>
          <button
            onClick={copyBody}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-accent active:bg-accent transition-colors"
            title="Copy response"
          >
            {copied ? <Check size={14} className="text-success" /> : <Copy size={14} className="text-muted-foreground" />}
          </button>
          <button
            onClick={saveResponseToDisk}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-accent active:bg-accent transition-colors"
            title={t("response.save_to_file")}
          >
            {savedFlash ? <Check size={14} className="text-success" /> : <Download size={14} className="text-muted-foreground" />}
          </button>
          {/* More-actions kebab menu: holds the secondary share/export
              actions so we don't blow up the action bar with seven inline
              buttons. The first three are clipboard exports; the fourth
              opens the save-to-variable modal. */}
          <div className="relative" ref={moreMenuRef}>
            <button
              onClick={() => setMoreOpen((v) => !v)}
              className={`w-7 h-7 flex items-center justify-center rounded-lg transition-colors ${moreOpen ? "bg-primary/15" : "hover:bg-accent"}`}
              title={t("response.more_actions")}
              aria-haspopup="menu"
              aria-expanded={moreOpen}
            >
              <MoreHorizontal size={14} className={moreOpen ? "text-primary" : "text-muted-foreground"} />
            </button>
            {moreOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full mt-1 z-20 min-w-[200px] bg-card rounded-xl shadow-lg border border-border overflow-hidden text-[12px]"
              >
                <button
                  onClick={copyUrl}
                  role="menuitem"
                  className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-muted"
                >
                  <Link2 size={13} className="text-muted-foreground" />
                  {t("response.copy_url")}
                </button>
                <button
                  onClick={copyAsCurl}
                  role="menuitem"
                  className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-muted"
                >
                  <Terminal size={13} className="text-muted-foreground" />
                  {t("response.copy_curl")}
                </button>
                <button
                  onClick={copyAsHar}
                  role="menuitem"
                  className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-muted"
                >
                  <Archive size={13} className="text-muted-foreground" />
                  {t("response.copy_har")}
                </button>
                <div className="border-t border-border" />
                <button
                  onClick={openSaveToVariable}
                  role="menuitem"
                  className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-muted"
                >
                  <Variable size={13} className="text-muted-foreground" />
                  {t("response.save_to_variable")}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Non-blocking action flash: shows briefly after copy / save so the
          user knows the clipboard / store mutation succeeded without an
          extra modal. Auto-clears after 2 s via the effect above. */}
      {actionFlash && (
        <div className="shrink-0 px-4 pb-1.5 bg-card">
          <div className="inline-flex items-center gap-1.5 text-[11px] text-success bg-success/10 rounded-md px-2 py-1">
            <Check size={11} />
            {actionFlash}
          </div>
        </div>
      )}

      {/* JSONPath bar */}
      {jsonPathOpen && activeTab === "body" && bodyIsJson && (
        <div className="shrink-0 px-4 pb-2 bg-card">
          <div className="relative">
            <Filter size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              value={jsonPath}
              onChange={(e) => setJsonPath(e.target.value)}
              placeholder="$.path.to.value  ·  $.items[*].name  ·  $..id"
              autoFocus
              className="h-8 w-full pl-8 pr-7 font-mono text-[12px]"
            />
            {jsonPath && (
              <button
                onClick={() => setJsonPath("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-muted-foreground"
              >
                <X size={12} />
              </button>
            )}
          </div>
          {jsonPathResult.error && (
            <div className="mt-1 text-[11px] text-destructive">{jsonPathResult.error}</div>
          )}
        </div>
      )}

      {/* Search bar */}
      {searchOpen && activeTab === "body" && (
        <div className="shrink-0 px-4 pb-2 bg-card">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                goToSearchMatch(e.shiftKey ? "previous" : "next");
              }}
              placeholder={t("response.search_placeholder")}
              autoFocus
              className="h-8 w-full pl-8 pr-36 text-[12px]"
            />
            {searchQuery && (
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 text-muted-foreground">
                <span className="min-w-[42px] text-right text-[11px] tabular-nums">
                  {searchMatchCount > 0 ? `${activeSearchMatch + 1}/${searchMatchCount}` : "0/0"}
                </span>
                <button
                  type="button"
                  onClick={() => goToSearchMatch("previous")}
                  disabled={searchMatchCount === 0}
                  className="w-5 h-5 flex items-center justify-center rounded hover:bg-accent disabled:opacity-35 disabled:cursor-not-allowed"
                  title="Previous match"
                >
                  <ChevronUp size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => goToSearchMatch("next")}
                  disabled={searchMatchCount === 0}
                  className="w-5 h-5 flex items-center justify-center rounded hover:bg-accent disabled:opacity-35 disabled:cursor-not-allowed"
                  title="Next match"
                >
                  <ChevronDown size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="w-5 h-5 flex items-center justify-center rounded hover:bg-accent hover:text-muted-foreground"
                  title="Clear search"
                >
                  <X size={12} />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto px-4 pb-4">
        {activeTab === "body" && response.body_truncated && (
          <div className="mb-2 flex items-center gap-2 text-[11px] text-warning bg-warning/10 rounded-lg px-2.5 py-1.5">
            <AlertTriangle size={12} />
            Response was truncated for display ({formatSize(response.size_bytes)}). Use
            <button onClick={saveResponseToDisk} className="underline hover:no-underline">Save</button>
            to get the full body.
          </div>
        )}
        {activeTab === "body" && isBinary && mime.startsWith("image/") && (
          <div className="flex items-center justify-center bg-muted rounded-lg p-3">
            <img
              src={`data:${mime};base64,${response.body}`}
              alt="response"
              className="max-w-full max-h-[480px] object-contain"
            />
          </div>
        )}
        {activeTab === "body" && isBinary && mime === "application/pdf" && (
          <iframe
            title="PDF preview"
            src={`data:application/pdf;base64,${response.body}`}
            className="w-full h-[640px] bg-muted rounded-lg"
          />
        )}
        {activeTab === "body" && isBinary && !mime.startsWith("image/") && mime !== "application/pdf" && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <FileQuestion size={12} />
              Binary response ({mime || "unknown type"}, {formatSize(response.size_bytes)}). Hex dump of
              first 4&thinsp;KiB:
            </div>
            <pre className="text-[11px] font-mono text-foreground whitespace-pre leading-[1.55] bg-muted rounded-lg p-3 overflow-auto">
              {hexDump(response.body)}
            </pre>
          </div>
        )}
        {activeTab === "body" && !isBinary && bodyView === "tree" && !searchQuery && bodyIsJson && displayJson !== undefined && (
          <VirtualJsonTree data={displayJson} className="bg-muted rounded-lg p-3" />
        )}
        {activeTab === "body" && !isBinary && (bodyView === "raw" || searchQuery || !bodyIsJson || displayJson === undefined) && (
          <pre className="text-[12px] font-mono text-foreground whitespace-pre-wrap break-all leading-[1.65] bg-muted rounded-lg p-3">
            {searchQuery
              ? highlightedSearchBody
              : bodyIsJson
              ? highlightJson(displayBody)
              : displayBody}
          </pre>
        )}
        {activeTab === "headers" && (
          <div className="bg-muted rounded-lg overflow-hidden">
            {Object.entries(response.headers).map(([key, value], i) => (
              <div
                key={key}
                className={`flex gap-4 px-3 py-2 ${i !== Object.entries(response.headers).length - 1 ? "border-b border-border/60" : ""}`}
              >
                <span className="text-[12px] font-medium text-primary shrink-0 w-44 truncate">
                  {key}
                </span>
                <span className="text-[12px] text-muted-foreground break-all">{value}</span>
              </div>
            ))}
          </div>
        )}
        {activeTab === "tests" && (
          <div className="space-y-3">
            {sErr && (
              <div className="bg-destructive/5 text-destructive rounded-lg px-3 py-2 text-[12px]">
                {sErr}
              </div>
            )}
            {tests && tests.length > 0 && (
              <div className="bg-muted rounded-lg overflow-hidden">
                {tests.map((t, i) => (
                  <div
                    key={i}
                    className={`flex items-start gap-2 px-3 py-2 ${
                      i !== tests.length - 1 ? "border-b border-border/60" : ""
                    }`}
                  >
                    <span
                      className={`mt-0.5 inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
                        t.passed ? "bg-success" : "bg-destructive"
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <div
                        className={`text-[12px] ${
                          t.passed ? "text-foreground" : "text-destructive"
                        }`}
                      >
                        {t.name}
                      </div>
                      {!t.passed && t.error && (
                        <div className="text-[11px] text-muted-foreground font-mono mt-0.5 break-words">
                          {t.error}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {tests && tests.length === 0 && !sErr && (
              <p className="text-[12px] text-muted-foreground">
                Test script ran without recording any assertions.
              </p>
            )}
            {logs && logs.length > 0 && (
              <div>
                <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                  Console
                </div>
                <pre className="text-[11px] font-mono whitespace-pre-wrap bg-muted rounded-lg p-3">
                  {logs
                    .map(
                      (l) =>
                        `${l.level === "error" ? "✕" : l.level === "warn" ? "!" : "›"} ${l.args.join(" ")}`
                    )
                    .join("\n")}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
      {diffOpen && (
        <ResponseDiffModal
          snapshots={snapshots}
          onClose={() => setDiffOpen(false)}
        />
      )}
      {saveVariableOpen && response && (
        <SaveToVariableModal
          response={response}
          initialJsonPath={jsonPath}
          onClose={() => setSaveVariableOpen(false)}
          onSaved={({ envId, key }) => {
            const envName =
              environments.find((e) => e.id === envId)?.name ?? envId;
            flash(
              t("response.save_to_variable_done", {
                env: envName,
                key,
              }),
            );
          }}
        />
      )}
    </div>
  );
}

interface TimingPillProps {
  timeMs: number;
  timings?: import("../types").ResponseTimings;
}

/**
 * Time chip rendered in the response status bar. Shows total ms inline,
 * reveals a wait/download breakdown on hover (only when the backend
 * supplied one — legacy persisted responses may omit it).
 */
function TimingPill({ timeMs, timings }: TimingPillProps) {
  const [open, setOpen] = useState(false);
  if (!timings) {
    return <span className="text-[11px] text-muted-foreground">{timeMs} ms</span>;
  }
  const { wait_ms, download_ms, total_ms } = timings;
  const profiled = !!(timings.dns_ms || timings.tcp_ms || timings.tls_ms);
  const safeTotal = Math.max(total_ms, 1);
  const waitPct = (wait_ms / safeTotal) * 100;
  const dlPct = Math.max(0, 100 - waitPct);
  return (
    <div
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span className="text-[11px] text-muted-foreground cursor-help underline decoration-dotted underline-offset-2">
        {total_ms} ms
      </span>
      {open && (
        <div className="absolute left-0 top-full mt-1 w-72 z-40 rounded-xl border border-border bg-card shadow-lg p-3 text-[11px]">
          <div className="font-semibold text-muted-foreground mb-2">Response timing</div>
          <div className="flex h-2 rounded-full overflow-hidden bg-muted mb-2">
            <div className="bg-primary/70" style={{ width: `${waitPct}%` }} />
            <div className="bg-success/70" style={{ width: `${dlPct}%` }} />
          </div>
          <div className="space-y-1">
            <Row
              label={profiled ? "Wait (TTFB)" : "Wait (DNS + TCP + TLS + TTFB)"}
              ms={wait_ms}
              dotClass="bg-primary/70"
            />
            <Row label="Download" ms={download_ms} dotClass="bg-success/70" />
            <div className="border-t border-border my-1" />
            <Row label="Total" ms={total_ms} dotClass="bg-transparent" bold />
            {profiled && (
              <>
                <div className="border-t border-border my-1" />
                <div className="text-[10px] text-muted-foreground/70">
                  Connection probe (separate connection)
                </div>
                {timings.dns_ms ? (
                  <Row label="DNS lookup" ms={timings.dns_ms} dotClass="bg-orange/70" />
                ) : null}
                {timings.tcp_ms ? (
                  <Row label="TCP connect" ms={timings.tcp_ms} dotClass="bg-purple/70" />
                ) : null}
                {timings.tls_ms ? (
                  <Row label="TLS handshake" ms={timings.tls_ms} dotClass="bg-teal/70" />
                ) : null}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  ms,
  dotClass,
  bold,
}: {
  label: string;
  ms: number;
  dotClass: string;
  bold?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className={`inline-block w-2 h-2 rounded-full ${dotClass}`} />
      <span className={`flex-1 ${bold ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
        {label}
      </span>
      <span className={`font-mono ${bold ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
        {ms} ms
      </span>
    </div>
  );
}
