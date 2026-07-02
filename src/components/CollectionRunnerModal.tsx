import { useState, useRef } from "react";
import { Play, Square, CheckCircle2, XCircle, Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useRequestStore } from "../store/useRequestStore";
import {
  executeRequestWithScripts,
  pipelineDefaultsFrom,
} from "../utils/requestPipeline";
import { buildScopedVars } from "../utils/variableScope";
import { exportHtml, exportJson, exportJUnit } from "../utils/runnerExport";
import { CodeEditor } from "./CodeEditor";
import type {
  Collection,
  CollectionRequest,
  CollectionFolder,
  RequestItem,
  KeyValue,
} from "../types";

import type { RunResult } from "../utils/runnerExport";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function genId(): string {
  return Math.random().toString(36).substring(2, 15);
}

function emptyKV(): KeyValue {
  return { id: genId(), key: "", value: "", enabled: true };
}

function flattenRequests(col: Collection): CollectionRequest[] {
  const result: CollectionRequest[] = [...col.requests];
  function walk(folders: CollectionFolder[]) {
    for (const f of folders) {
      result.push(...f.requests);
      walk(f.folders);
    }
  }
  walk(col.folders);
  return result;
}

function colReqToRequestItem(
  req: CollectionRequest,
  collectionId: string
): RequestItem {
  return {
    id: req.id,
    name: req.name,
    method: req.method as RequestItem["method"],
    url: req.url,
    headers: req.headers.length > 0 ? req.headers : [emptyKV()],
    params: req.params.length > 0 ? req.params : [emptyKV()],
    body: req.body,
    bodyType: req.body_type as RequestItem["bodyType"],
    formData: [emptyKV()],
    auth: req.auth,
    description: req.description,
    preScript: req.pre_script,
    testScript: req.test_script,
    collectionId,
    protocol: "http",
    createdAt: req.created_at,
  };
}

interface Props {
  collectionId: string;
  onClose: () => void;
}

export function CollectionRunnerModal({ collectionId, onClose }: Props) {
  const { t } = useTranslation();
  const collections = useRequestStore((s) => s.collections);
  const environments = useRequestStore((s) => s.environments);
  const workspace = useRequestStore((s) => s.workspace);

  const col = collections.find((c) => c.id === collectionId);

  const [iterations, setIterations] = useState(1);
  const [delayMs, setDelayMs] = useState(0);
  const [dataJson, setDataJson] = useState("");
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<RunResult[]>([]);
  const cancelRef = useRef(false);

  if (!col) return null;

  const requests = flattenRequests(col);

  const run = async () => {
    cancelRef.current = false;
    setRunning(true);
    setResults([]);

    // Parse data file (optional JSON array of records).
    let dataRows: Record<string, string>[] = [];
    if (dataJson.trim()) {
      try {
        const parsed = JSON.parse(dataJson.trim());
        if (Array.isArray(parsed)) {
          dataRows = parsed.map((r) => {
            const obj: Record<string, string> = {};
            for (const [k, v] of Object.entries(r as Record<string, unknown>)) {
              obj[k] = String(v);
            }
            return obj;
          });
        }
      } catch {
        setResults([
          {
            name: t("runner.data_label"),
            method: "",
            error: t("runner.data_invalid"),
            tests: [],
            iteration: 0,
          },
        ]);
        setRunning(false);
        return;
      }
    }
    const effectiveIterations = Math.max(iterations, dataRows.length || iterations);

    for (let iter = 0; iter < effectiveIterations; iter++) {
      if (cancelRef.current) break;

      // Merge data row for this iteration.
      const dataRow = dataRows[iter] ?? {};
      const transientVars: Record<string, string> = { ...dataRow };

      // Per-iteration scope maps for pm.globals / pm.collectionVariables.
      // Initialized from the workspace/collection state at the start of
      // each iteration, then mutated in place across all requests within
      // the iteration so that `pm.globals.set("token", "abc")` in
      // Request A is visible to Request B — matching Postman runner
      // semantics. A fresh copy is taken per iteration so iterations stay
      // independent.
      const globalVars: Record<string, string> = {};
      for (const v of workspace?.variables ?? []) {
        if (v.enabled && v.key) globalVars[v.key] = v.value;
      }
      const owningCollection = collections.find((c) => c.id === collectionId);
      const collectionVars: Record<string, string> = {};
      for (const v of owningCollection?.variables ?? []) {
        if (v.enabled && v.key) collectionVars[v.key] = v.value;
      }

      for (const req of requests) {
        if (cancelRef.current) break;

        const requestItem = colReqToRequestItem(req, collectionId);
        // Build per-request scope chain: each request may live in a
        // different folder, so resolve fresh inside the loop. The runner
        // intentionally drops script-induced env mutations between
        // iterations (each iteration gets a clean slate).
        const envVars = buildScopedVars({
          workspace,
          collections,
          environments,
          request: requestItem,
        });
        const result = await executeRequestWithScripts({
          request: requestItem,
          collections,
          envVars,
          transientVars,
          globalVars,
          collectionVars,
          iterationData: dataRow,
          defaults: pipelineDefaultsFrom(useRequestStore.getState()),
        });

        const entry: RunResult = {
          name: req.name || req.url,
          method: req.method,
          status: result.response?.status,
          timeMs: result.response?.time_ms,
          tests: result.tests,
          error: result.error?.message || result.scriptError,
          iteration: iter + 1,
        };
        setResults((prev) => [...prev, entry]);

        if (delayMs > 0) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
    }
    setRunning(false);
  };

  const totalTests = results.reduce((s, r) => s + r.tests.length, 0);
  const passedTests = results.reduce(
    (s, r) => s + r.tests.filter((t) => t.passed).length,
    0
  );
  const failedTests = totalTests - passedTests;
  const erroredRequests = results.filter((r) => r.error).length;

  const doExport = async (format: "junit" | "json" | "html") => {
    const ext = format === "junit" ? "xml" : format;
    const filters =
      format === "junit"
        ? [{ name: "JUnit XML", extensions: ["xml"] }]
        : format === "json"
          ? [{ name: "JSON", extensions: ["json"] }]
          : [{ name: "HTML", extensions: ["html"] }];
    const path = await saveFileDialog({
      defaultPath: `${col.name}-run.${ext}`,
      filters,
    });
    if (!path) return;
    // Derive iteration count from actual results, not the input field
    // (the input may have changed post-run, or data file may override it).
    const actualIterations = Math.max(...results.map((r) => r.iteration), 0);
    const content =
      format === "junit"
        ? exportJUnit(results, col.name, actualIterations)
        : format === "json"
          ? exportJson(results, col.name, actualIterations)
          : exportHtml(results, col.name, actualIterations);
    await invoke("write_file", { path, contents: content });
  };

  // Portal to <body> so we escape the sidebar's `backdrop-blur-xl`
  // containing block (without it, the modal is clipped to the sidebar).
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="flex max-h-[85vh] w-[92vw] max-w-[820px] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-4 py-3 text-left">
          <DialogTitle className="text-[13px]">
            {t("runner.title", { name: col.name })}
          </DialogTitle>
        </DialogHeader>

        {/* Config */}
        <div className="px-4 py-3 border-b border-border space-y-2">
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
              {t("runner.iterations")}
              <Input
                type="number"
                min={1}
                max={1000}
                value={iterations}
                onChange={(e) => setIterations(Math.max(1, Number(e.target.value)))}
                disabled={running}
                className="h-7 w-16 px-2 text-[12px]"
              />
            </label>
            <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
              {t("runner.delay_ms")}
              <Input
                type="number"
                min={0}
                step={100}
                value={delayMs}
                onChange={(e) => setDelayMs(Math.max(0, Number(e.target.value)))}
                disabled={running}
                className="h-7 w-20 px-2 text-[12px]"
              />
            </label>
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground block mb-1">
              {t("runner.data")}
            </label>
            <CodeEditor
              value={dataJson}
              onChange={setDataJson}
              language="json"
              height={80}
              readOnly={running}
              placeholder={t("runner.data_placeholder")}
            />
          </div>
          <div className="flex items-center gap-2">
            {!running ? (
              <Button
                size="sm"
                onClick={run}
                disabled={requests.length === 0}
                className="gap-1.5"
              >
                <Play size={12} />
                {t("runner.run_with_count", { count: requests.length })}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  cancelRef.current = true;
                }}
                className="gap-1.5 bg-destructive/10 text-destructive hover:bg-destructive/15"
              >
                <Square size={12} />
                {t("runner.stop")}
              </Button>
            )}
            {results.length > 0 && !running && (
              <>
                <span className="text-[11px] text-muted-foreground">
                  {totalTests > 0 && (
                    <span>
                      {t("runner.summary_passed_failed", { passed: passedTests, failed: failedTests })}
                      {erroredRequests > 0 && t("runner.summary_errored", { count: erroredRequests })}
                    </span>
                  )}
                  {totalTests === 0 && t("runner.summary_completed", { count: results.length })}
                </span>
                <div className="ml-auto">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 text-[11px]"
                      >
                        <Download size={12} />
                        {t("runner.export")}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      className="min-w-[140px] text-[12px]"
                    >
                      <DropdownMenuItem onSelect={() => doExport("junit")}>
                        {t("runner.export_junit")}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => doExport("json")}>
                        {t("runner.export_json")}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => doExport("html")}>
                        {t("runner.export_html")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-auto px-4 py-2">
          {results.length === 0 && !running && (
            <p className="text-[12px] text-muted-foreground py-4 text-center">
              {t("runner.hint")}
            </p>
          )}
          {results.map((r, i) => (
            <div
              key={i}
              className="flex items-center gap-2 py-1.5 border-b border-border/40 last:border-b-0"
            >
              {r.error ? (
                <XCircle size={13} className="text-destructive shrink-0" />
              ) : r.tests.length > 0 && r.tests.every((t) => t.passed) ? (
                <CheckCircle2 size={13} className="text-success shrink-0" />
              ) : r.tests.some((t) => !t.passed) ? (
                <XCircle size={13} className="text-destructive shrink-0" />
              ) : (
                <CheckCircle2 size={13} className="text-muted-foreground shrink-0" />
              )}
              <span className="text-[11px] font-mono text-muted-foreground w-12 shrink-0">
                {r.method}
              </span>
              <span className="text-[12px] text-foreground truncate flex-1">
                {r.name}
              </span>
              {r.status && (
                <span className="text-[11px] text-muted-foreground">{r.status}</span>
              )}
              {r.timeMs !== undefined && (
                <span className="text-[11px] text-muted-foreground">{r.timeMs}ms</span>
              )}
              {iterations > 1 && (
                <span className="text-[10px] text-muted-foreground">#{r.iteration}</span>
              )}
              {r.error && (
                <span className="text-[11px] text-destructive truncate max-w-[150px]">
                  {r.error}
                </span>
              )}
            </div>
          ))}
          {running && (
            <div className="flex items-center gap-2 py-2">
              <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <span className="text-[11px] text-muted-foreground">{t("runner.running")}</span>
            </div>
          )}
      </div>
      </DialogContent>
    </Dialog>
  );
}
