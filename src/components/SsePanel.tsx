import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useRequestStore } from "../store/useRequestStore";

/**
 * Panel shown in place of the regular response view when the active request is
 * configured for SSE. Connect / disconnect, see live frames, filter, clear.
 */
export function SsePanel() {
  const { t } = useTranslation();
  const activeRequest = useRequestStore((s) => s.activeRequest);
  const sseConnected = useRequestStore((s) => s.sseConnected);
  const sseEvents = useRequestStore((s) => s.sseEvents);
  const sseConnect = useRequestStore((s) => s.sseConnect);
  const sseClose = useRequestStore((s) => s.sseClose);
  const error = useRequestStore((s) => s.error);

  const [filter, setFilter] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const logRef = useRef<HTMLDivElement>(null);

  const id = activeRequest?.id;
  const connected = id ? !!sseConnected[id] : false;
  const events = useMemo(() => (id ? sseEvents[id] ?? [] : []), [id, sseEvents]);

  const filtered = useMemo(() => {
    if (!filter.trim()) return events;
    const q = filter.toLowerCase();
    return events.filter((e) => {
      return (
        (e.event && e.event.toLowerCase().includes(q)) ||
        (e.data && e.data.toLowerCase().includes(q)) ||
        (e.lastEventId && e.lastEventId.toLowerCase().includes(q))
      );
    });
  }, [events, filter]);

  useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [filtered.length, autoScroll]);

  if (!activeRequest) return null;

  const messageCount = events.filter((e) => e.kind === "message").length;

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-2 flex items-center gap-2 border-b border-border">
        <span
          className={`w-2 h-2 rounded-full ${connected ? "bg-success" : "bg-muted-foreground"}`}
        />
        <span className="text-[12px] text-muted-foreground">
          {connected ? t("sse.connected") : t("sse.disconnected")}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {t("sse.event_count", { count: messageCount })}
        </span>
        <Input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t("sse.filter_placeholder")}
          className="h-7 max-w-xs flex-1 !text-[11px]"
        />
        <label
          htmlFor="sse-autoscroll"
          className="text-[11px] text-muted-foreground flex items-center gap-1 select-none cursor-pointer"
        >
          <Checkbox
            id="sse-autoscroll"
            checked={autoScroll}
            onCheckedChange={(c) => setAutoScroll(c === true)}
          />
          {t("sse.follow")}
        </label>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => {
              const reqId = activeRequest.id;
              // Clear local event log without touching the connection.
              useRequestStore.setState((s) => ({
                sseEvents: { ...s.sseEvents, [reqId]: [] },
              }));
            }}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-accent active:bg-accent transition-colors"
            title={t("sse.clear_log")}
          >
            <Trash2 size={14} className="text-muted-foreground" />
          </button>
          {!connected ? (
            <Button
              size="sm"
              onClick={() => sseConnect()}
              disabled={!activeRequest.url}
              className="!px-3 !py-1 !text-[12px]"
            >
              {t("sse.connect")}
            </Button>
          ) : (
            <button
              onClick={() => sseClose()}
              className="px-3 py-1 bg-destructive text-destructive-foreground font-medium rounded-lg text-[12px] hover:bg-destructive/90 active:scale-[0.97] transition-all"
            >
              {t("sse.disconnect")}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="px-4 py-2 text-[11px] text-destructive border-b border-border bg-destructive/5">
          {error.message}
        </div>
      )}

      <div ref={logRef} className="flex-1 overflow-auto p-3 space-y-1 bg-muted/40">
        {filtered.length === 0 && (
          <div className="text-center py-12 text-[12px] text-muted-foreground">
            {connected ? t("sse.waiting") : t("sse.not_connected")}
          </div>
        )}
        {filtered.map((e) => {
          const isMsg = e.kind === "message";
          const isErr = e.kind === "error";
          return (
            <div
              key={e.id}
              className={`px-2 py-1.5 rounded text-[12px] font-mono ${
                isErr
                  ? "bg-destructive/10 text-destructive"
                  : isMsg
                    ? "bg-card text-foreground"
                    : "bg-transparent text-muted-foreground italic"
              }`}
            >
              <div className="flex items-center gap-2 text-[10px] opacity-70">
                <span>{new Date(e.ts).toLocaleTimeString()}</span>
                <span className="uppercase">{e.kind}</span>
                {e.event && (
                  <span className="px-1.5 py-0.5 bg-primary/10 text-primary rounded font-semibold uppercase">
                    {e.event}
                  </span>
                )}
                {e.lastEventId && <span>{t("sse.id_label")} {e.lastEventId}</span>}
                {typeof e.retry === "number" && <span>{t("sse.retry_label", { n: e.retry })}</span>}
              </div>
              {isErr && e.error && (
                <div className="mt-1 whitespace-pre-wrap break-all">{e.error}</div>
              )}
              {isMsg && e.data !== undefined && (
                <div className="mt-1 whitespace-pre-wrap break-all">{e.data}</div>
              )}
              {!isErr && !isMsg && !e.data && !e.error && (
                <div className="mt-1 opacity-60">
                  ({e.kind === "open" ? t("sse.stream_open") : e.kind === "close" ? t("sse.stream_closed") : e.kind})
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
