import { useState } from "react";
import { X, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useRequestStore } from "../store/useRequestStore";
import { DEFAULT_REQUEST_NAME } from "../store/storeHelpers";
import type { HttpMethod } from "../types";
import { ContextMenu } from "./ContextMenu";

const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: "text-success",
  POST: "text-orange",
  PUT: "text-primary",
  PATCH: "text-purple",
  DELETE: "text-destructive",
  HEAD: "text-muted-foreground",
  OPTIONS: "text-muted-foreground",
};

export function TabBar() {
  const { t } = useTranslation();
  const tabs = useRequestStore((s) => s.tabs);
  const activeTabId = useRequestStore((s) => s.activeTabId);
  const loadings = useRequestStore((s) => s.loadings);
  const setActiveTab = useRequestStore((s) => s.setActiveTab);
  const closeTab = useRequestStore((s) => s.closeTab);
  const createNewRequest = useRequestStore((s) => s.createNewRequest);
  const reorderTabs = useRequestStore((s) => s.reorderTabs);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; tabId: string } | null>(null);

  return (
    <div className="flex items-center gap-0.5 px-3 pt-2 overflow-x-auto border-b border-border bg-muted/40">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        const isLoading = !!loadings[tab.id];
        const methodLabel = tab.protocol === "websocket" ? "WS" : tab.method;
        // Treat a request still carrying the default name as "unnamed" and
        // surface its URL instead, so a freshly-created tab stops reading
        // "New Request" the moment the user types an address.
        const hasCustomName = !!tab.name && tab.name !== DEFAULT_REQUEST_NAME;
        const urlText = tab.url?.trim() ?? "";
        const label = hasCustomName
          ? tab.name
          : urlText || tab.name || t("tab.placeholder_name");
        // Tip reveals the full URL (the label truncates) plus the method.
        const tip = urlText ? `${methodLabel}  ${urlText}` : label;
        return (
          <div
            key={tab.id}
            draggable
            onDragStart={() => setDraggingId(tab.id)}
            onDragOver={(e) => {
              e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (draggingId && draggingId !== tab.id) {
                reorderTabs(draggingId, tab.id);
              }
              setDraggingId(null);
            }}
            onDragEnd={() => setDraggingId(null)}
            onClick={() => setActiveTab(tab.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              setCtxMenu({ x: e.clientX, y: e.clientY, tabId: tab.id });
            }}
            className={`group flex items-center gap-1.5 px-2.5 py-1.5 rounded-t-md cursor-pointer min-w-[140px] max-w-[220px] border-t border-l border-r transition-colors ${
              isActive
                ? "bg-card border-border text-foreground"
                : "border-transparent text-muted-foreground hover:bg-card/60"
            }`}
            title={tip}
          >
            <span className={`text-[10px] font-semibold shrink-0 ${METHOD_COLORS[tab.method]}`}>
              {methodLabel}
            </span>
            <span className="text-[12px] truncate flex-1">{label}</span>
            {isLoading && (
              <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0 animate-pulse" />
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
              className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-accent rounded transition-all shrink-0"
              title={t("tab.close")}
            >
              <X size={11} className="text-muted-foreground" />
            </button>
          </div>
        );
      })}
      <button
        onClick={createNewRequest}
        className="ml-1 w-7 h-7 flex items-center justify-center rounded-md hover:bg-accent transition-colors shrink-0"
        title={t("tab.new_tab")}
      >
        <Plus size={14} className="text-muted-foreground" />
      </button>
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          items={[
            {
              label: t("context_menu.close"),
              onSelect: () => closeTab(ctxMenu.tabId),
            },
            {
              label: t("context_menu.close_others"),
              onSelect: () => {
                tabs
                  .filter((tb) => tb.id !== ctxMenu.tabId)
                  .map((tb) => tb.id)
                  .forEach((id) => closeTab(id));
              },
            },
            {
              label: t("context_menu.copy_name"),
              onSelect: () => {
                const tb = tabs.find((x) => x.id === ctxMenu.tabId);
                if (tb) navigator.clipboard?.writeText(tb.name || tb.url || "");
              },
            },
          ]}
        />
      )}
    </div>
  );
}
