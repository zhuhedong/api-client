import { useEffect, useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { useRequestStore } from "../store/useRequestStore";

export function WsPanel() {
  const { t } = useTranslation();
  const activeRequest = useRequestStore((s) => s.activeRequest);
  const wsConnected = useRequestStore((s) => s.wsConnected);
  const wsMessages = useRequestStore((s) => s.wsMessages);
  const wsConnect = useRequestStore((s) => s.wsConnect);
  const wsSend = useRequestStore((s) => s.wsSend);
  const wsClose = useRequestStore((s) => s.wsClose);

  const [text, setText] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  const id = activeRequest?.id;
  const connected = id ? !!wsConnected[id] : false;
  const messages = (id ? wsMessages[id] : undefined) ?? [];

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [messages.length]);

  if (!activeRequest) return null;

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-2 flex items-center gap-2 border-b border-border">
        <span
          className={`w-2 h-2 rounded-full ${connected ? "bg-success" : "bg-muted-foreground"}`}
        />
        <span className="text-[12px] text-muted-foreground">
          {connected ? t("ws.connected") : t("ws.disconnected")}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {!connected ? (
            <Button
              size="sm"
              onClick={() => wsConnect()}
              disabled={!activeRequest.url}
              className="!px-3 !py-1 !text-[12px]"
            >
              {t("ws.connect")}
            </Button>
          ) : (
            <button
              onClick={() => wsClose()}
              className="px-3 py-1 bg-destructive text-white font-medium rounded-lg text-[12px] hover:bg-destructive/90 active:scale-[0.97] transition-all"
            >
              {t("ws.disconnect")}
            </button>
          )}
        </div>
      </div>

      <div ref={logRef} className="flex-1 overflow-auto p-3 space-y-1 bg-muted/40">
        {messages.length === 0 && (
          <div className="text-center py-12 text-[12px] text-muted-foreground">
            {t("ws.empty")}
          </div>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex items-start gap-2 px-2 py-1.5 rounded text-[12px] font-mono ${
              m.direction === "sent"
                ? "bg-primary/10 text-primary"
                : m.direction === "received"
                ? "bg-card text-foreground"
                : "bg-transparent text-muted-foreground italic"
            }`}
          >
            <span className="text-[10px] shrink-0 opacity-60">
              {new Date(m.ts).toLocaleTimeString()}
            </span>
            <span className="text-[10px] shrink-0 uppercase opacity-60 w-12">
              {m.direction}
            </span>
            <span className="flex-1 whitespace-pre-wrap break-all">{m.text}</span>
          </div>
        ))}
      </div>

      <div className="p-3 border-t border-border flex items-end gap-2">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              if (text.trim()) {
                wsSend(text);
                setText("");
              }
            }
          }}
          placeholder={t("ws.placeholder")}
          className="h-14 flex-1 resize-none font-mono text-[12px]"
          disabled={!connected}
        />
        <Button
          onClick={() => {
            if (text.trim()) {
              wsSend(text);
              setText("");
            }
          }}
          disabled={!connected || !text.trim()}
        >
          {t("ws.send")}
        </Button>
      </div>
    </div>
  );
}
