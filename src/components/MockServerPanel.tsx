import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Play, Square, Plus, Trash2, Copy, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { KeyValue, MockRoute, MockServerStatus } from "../types";
import { useRequestStore } from "../store/useRequestStore";
import { KeyValueEditor } from "./KeyValueEditor";
import { CodeEditor } from "./CodeEditor";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

/** Tack a synthetic `id` onto every header row so KeyValueEditor can use it
 *  as a React key — the backend doesn't store ids on KeyValue. */
function hydrateHeaders(headers: KeyValue[] | undefined): KeyValue[] {
  if (!headers || headers.length === 0) {
    return [{ id: generateId(), key: "", value: "", enabled: true }];
  }
  return headers.map((h) => ({ ...h, id: (h as KeyValue).id ?? generateId() }));
}

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "*"];

export function MockServerPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const workspace = useRequestStore((s) => s.workspace);
  const workspaceId = workspace?.id;

  const [status, setStatus] = useState<MockServerStatus>({ running: false });
  const [routes, setRoutes] = useState<MockRoute[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [port, setPort] = useState<string>("0");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<MockRoute | null>(null);

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const [s, r] = await Promise.all([
        invoke<MockServerStatus>("mock_server_status"),
        invoke<MockRoute[]>("list_mock_routes", { workspaceId }),
      ]);
      setStatus(s);
      setRoutes(r);
      if (!selectedId && r.length > 0) setSelectedId(r[0].id);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [workspaceId, selectedId]);

  // Data-fetching effect: `refresh` issues async invoke() calls and then
  // calls setState with the result. This is the canonical effect-based fetch
  // pattern; the cascading-render warning doesn't apply because the setState
  // happens after the awaited fetch, not synchronously inside the effect body.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  const selected = useMemo(
    () => routes.find((r) => r.id === selectedId) ?? null,
    [routes, selectedId],
  );

  const start = async () => {
    if (!workspaceId) return;
    setError(null);
    try {
      const p = Number.parseInt(port, 10);
      const actualPort = await invoke<number>("mock_server_start", {
        workspaceId,
        port: Number.isFinite(p) ? p : 0,
      });
      setStatus({ running: true, port: actualPort, workspace_id: workspaceId });
    } catch (e) {
      setError(String(e));
    }
  };

  const stop = async () => {
    setError(null);
    try {
      await invoke("mock_server_stop");
      setStatus({ running: false });
    } catch (e) {
      setError(String(e));
    }
  };

  const createRoute = async () => {
    if (!workspaceId) return;
    setError(null);
    const now = Date.now();
    const route: MockRoute = {
      id: generateId(),
      method: "GET",
      path: "/api/example",
      status: 200,
      headers: [],
      body: '{"ok": true}',
      enabled: true,
      created_at: now,
      updated_at: now,
    };
    try {
      const saved = await invoke<MockRoute>("save_mock_route", { workspaceId, route });
      setRoutes((prev) => [...prev, saved]);
      setSelectedId(saved.id);
    } catch (e) {
      setError(String(e));
    }
  };

  const duplicateRoute = async (route: MockRoute) => {
    if (!workspaceId) return;
    const now = Date.now();
    const copy: MockRoute = {
      ...route,
      id: generateId(),
      path: route.path + "-copy",
      created_at: now,
      updated_at: now,
    };
    try {
      const saved = await invoke<MockRoute>("save_mock_route", { workspaceId, route: copy });
      setRoutes((prev) => [...prev, saved]);
      setSelectedId(saved.id);
    } catch (e) {
      setError(String(e));
    }
  };

  const updateSelected = async (patch: Partial<MockRoute>) => {
    if (!workspaceId || !selected) return;
    const next: MockRoute = { ...selected, ...patch, updated_at: Date.now() };
    setRoutes((prev) => prev.map((r) => (r.id === next.id ? next : r)));
    try {
      await invoke("save_mock_route", { workspaceId, route: next });
    } catch (e) {
      setError(String(e));
    }
  };

  const deleteSelected = () => {
    if (!workspaceId || !selected) return;
    setConfirmDelete(selected);
  };

  const confirmDeleteRoute = async () => {
    if (!workspaceId || !confirmDelete) return;
    const route = confirmDelete;
    setConfirmDelete(null);
    try {
      await invoke("delete_mock_route", { workspaceId, id: route.id });
      setRoutes((prev) => prev.filter((r) => r.id !== route.id));
      setSelectedId(routes.find((r) => r.id !== route.id)?.id ?? null);
    } catch (e) {
      setError(String(e));
    }
  };

  const copyBaseUrl = () => {
    if (!status.port) return;
    const url = `http://127.0.0.1:${status.port}`;
    navigator.clipboard?.writeText(url).catch(() => {});
  };

  // Portal to <body> so we escape the sidebar's `backdrop-blur-xl`
  // containing block (without it, the modal is clipped to the sidebar).
  return (
    <>
      <Dialog
        open
        onOpenChange={(next) => {
          if (!next) onClose();
        }}
      >
        <DialogContent className="flex h-[85vh] w-[92vw] max-w-[1100px] flex-col gap-0 overflow-hidden p-0">
          {/* Header */}
          <DialogHeader className="flex-row items-center justify-between space-y-0 border-b border-border px-5 py-3 pr-12 text-left">
            <div>
              <DialogTitle className="text-base">{t("mock.title")}</DialogTitle>
              <p className="text-xs text-muted-foreground">
                {t("mock.workspace_label", { name: workspace?.name ?? "—" })}
              </p>
            </div>
          <div className="flex items-center gap-2">
            {status.running ? (
              <>
                <span className="rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success">
                  {t("mock.running_on", { port: status.port })}
                </span>
                <button
                  type="button"
                  onClick={copyBaseUrl}
                  className="rounded border border-border p-1.5 text-muted-foreground hover:bg-muted"
                  title={t("mock.copy_base_url")}
                >
                  <Copy size={14} />
                </button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={stop}
                  className="h-8 gap-1.5 bg-destructive/10 text-destructive hover:bg-destructive/15"
                >
                  <Square size={12} /> {t("mock.stop")}
                </Button>
              </>
            ) : (
              <>
                <Input
                  type="text"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  placeholder={t("mock.port_placeholder")}
                  className="h-8 w-20 text-xs"
                  title={t("mock.port_tooltip")}
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={start}
                  disabled={!workspaceId}
                  className="h-8 gap-1.5"
                >
                  <Play size={12} /> {t("mock.start")}
                </Button>
              </>
            )}
            <button
              type="button"
              onClick={refresh}
              disabled={loading}
              className="rounded border border-border p-1.5 text-muted-foreground hover:bg-muted"
              title={t("mock.refresh")}
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </DialogHeader>

        {error && (
          <div className="border-b border-destructive/30 bg-destructive/10 px-5 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {/* Body */}
        <div className="flex min-h-0 flex-1">
          {/* Route list */}
          <div className="flex w-72 flex-col border-r border-border">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="text-xs font-medium text-muted-foreground">
                {t("mock.routes_count", { count: routes.length })}
              </span>
              <Button
                type="button"
                size="sm"
                onClick={createRoute}
                className="h-7 gap-1.5 px-2"
              >
                <Plus size={12} /> {t("mock.new")}
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {routes.length === 0 && (
                <div className="px-3 py-4 text-xs text-muted-foreground">
                  {t("mock.empty")}
                </div>
              )}
              {routes.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSelectedId(r.id)}
                  className={`flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-xs hover:bg-muted ${
                    selectedId === r.id ? "bg-accent" : ""
                  }`}
                >
                  <span
                    className={`min-w-[3.5rem] rounded px-1.5 py-0.5 text-center text-[10px] font-bold ${methodColor(r.method)}`}
                  >
                    {r.method}
                  </span>
                  <span className="flex-1 truncate font-mono text-foreground">
                    {r.path}
                  </span>
                  {!r.enabled && (
                    <span className="text-[10px] uppercase text-muted-foreground">{t("common.off")}</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Editor */}
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
            {selected ? (
              <RouteEditor
                key={selected.id}
                route={selected}
                onChange={updateSelected}
                onDelete={deleteSelected}
                onDuplicate={() => duplicateRoute(selected)}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                {t("mock.select_or_create")}
              </div>
            )}
          </div>
        </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirmDelete !== null}
        title={t("mock.delete_confirm_title")}
        message={
          confirmDelete
            ? t("mock.delete_confirm_message", {
                method: confirmDelete.method,
                path: confirmDelete.path,
              })
            : ""
        }
        onConfirm={confirmDeleteRoute}
        onCancel={() => setConfirmDelete(null)}
      />
    </>
  );
}

// Filled-badge variant of the app's shared METHOD_COLORS hues (see
// TabBar/RequestPanel). Flat accent tokens with a /15 wash mirror the
// tagColor.ts convention; `bg-purple-100` etc. don't exist because the
// tailwind config overrides those scales with flat colors.
function methodColor(method: string): string {
  switch (method.toUpperCase()) {
    case "GET":
      return "bg-success/15 text-success";
    case "POST":
      return "bg-orange/15 text-orange";
    case "PUT":
      return "bg-primary/15 text-primary";
    case "PATCH":
      return "bg-purple/15 text-purple";
    case "DELETE":
      return "bg-destructive/15 text-destructive";
    default:
      return "bg-muted text-muted-foreground";
  }
}

interface RouteEditorProps {
  route: MockRoute;
  onChange: (patch: Partial<MockRoute>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}

function RouteEditor({ route, onChange, onDelete, onDuplicate }: RouteEditorProps) {
  const { t } = useTranslation();
  const [headers, setHeaders] = useState<KeyValue[]>(hydrateHeaders(route.headers));

  // When the user picks a different route, re-hydrate from the new value.
  // Uses the React-recommended "compare previous value during render" pattern
  // instead of useEffect to avoid a render-then-render cascade.
  const [prevRouteId, setPrevRouteId] = useState(route.id);
  if (route.id !== prevRouteId) {
    setPrevRouteId(route.id);
    setHeaders(hydrateHeaders(route.headers));
  }

  const commitHeaders = (next: KeyValue[]) => {
    setHeaders(next);
    onChange({ headers: next.filter((h) => h.key.trim().length > 0) });
  };

  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center gap-2">
        <label
          htmlFor="mock-route-enabled"
          className="flex cursor-pointer items-center gap-1 text-xs font-medium text-foreground"
        >
          <Checkbox
            id="mock-route-enabled"
            checked={route.enabled}
            onCheckedChange={(c) => onChange({ enabled: c === true })}
          />
          {t("mock.enabled")}
        </label>
        <div className="flex-1" />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onDuplicate}
          className="h-7 px-2 text-xs"
        >
          {t("mock.duplicate")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onDelete}
          className="h-7 gap-1.5 border-destructive/40 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 size={12} /> {t("mock.delete")}
        </Button>
      </div>

      <div className="flex gap-2">
        <Select
          value={route.method}
          onValueChange={(v) => onChange({ method: v })}
        >
          <SelectTrigger className="h-9 w-24 text-xs font-medium">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {METHODS.map((m) => (
              <SelectItem key={m} value={m} className="text-xs">
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="text"
          value={route.path}
          onChange={(e) => onChange({ path: e.target.value })}
          placeholder={t("mock.path_placeholder")}
          className="h-9 flex-1 font-mono text-xs"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">
            {t("mock.status_code")}
          </span>
          <Input
            type="number"
            value={route.status}
            onChange={(e) => onChange({ status: Number.parseInt(e.target.value, 10) || 200 })}
            className="h-9 text-xs"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">
            {t("mock.delay")}
          </span>
          <Input
            type="number"
            value={route.delay_ms ?? ""}
            onChange={(e) => {
              const v = e.target.value.trim();
              onChange({ delay_ms: v === "" ? undefined : Number.parseInt(v, 10) || 0 });
            }}
            placeholder="0"
            className="h-9 text-xs"
          />
        </label>
      </div>

      <div className="space-y-1">
        <span className="text-xs font-medium text-muted-foreground">
          {t("mock.response_headers")}
        </span>
        <KeyValueEditor
          items={headers}
          onChange={commitHeaders}
          keyPlaceholder={t("mock.header_placeholder")}
          valuePlaceholder={t("mock.value_placeholder")}
          reorderable={false}
        />
      </div>

      <div className="space-y-1">
        <span className="text-xs font-medium text-muted-foreground">
          {t("mock.response_body")}
        </span>
        <CodeEditor
          value={route.body}
          onChange={(v) => onChange({ body: v })}
          language="json"
          height={200}
          placeholder={t("mock.body_placeholder")}
        />
      </div>
    </div>
  );
}
