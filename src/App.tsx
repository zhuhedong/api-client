import { useEffect, useCallback, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Sidebar } from "./components/Sidebar";
import { RequestPanel } from "./components/RequestPanel";
import { ResponsePanel } from "./components/ResponsePanel";
import { TabBar } from "./components/TabBar";
import { WsPanel } from "./components/WsPanel";
import { SsePanel } from "./components/SsePanel";
import { SearchPalette } from "./components/SearchPalette";
import { SaveToCollectionModal } from "./components/SaveToCollectionModal";
import { Splitter } from "./components/Splitter";
import { useRequestStore } from "./store/useRequestStore";
import i18n from "./i18n";

const DEFAULT_SIDEBAR_WIDTH = 256;
const DEFAULT_REQUEST_PANEL_PCT = 48;

interface WsEvent {
  request_id: string;
  kind: string;
  text: string | null;
}

interface SseBackendEvent {
  request_id: string;
  kind: string;
  event?: string;
  data?: string;
  id?: string;
  retry?: number;
  error?: string;
}

function App() {
  const initialize = useRequestStore((s) => s.initialize);
  const initialized = useRequestStore((s) => s.initialized);
  const activeRequest = useRequestStore((s) => s.activeRequest);
  const workspace = useRequestStore((s) => s.workspace);
  const setWindowState = useRequestStore((s) => s.setWindowState);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [savePickerOpen, setSavePickerOpen] = useState(false);
  // Backend error from an in-place ⌘S save. When set, we open the
  // SaveToCollectionModal with the error pre-populated so the user sees
  // exactly what went wrong instead of silently believing the save
  // succeeded.
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);

  // Local mirror of the persisted layout numbers so dragging is smooth.
  // Persistence happens on drag end via setWindowState.
  const [sidebarWidth, setSidebarWidth] = useState<number>(
    workspace?.window_state?.sidebar_width ?? DEFAULT_SIDEBAR_WIDTH,
  );
  const [reqPanelPct, setReqPanelPct] = useState<number>(
    workspace?.window_state?.request_panel_height ?? DEFAULT_REQUEST_PANEL_PCT,
  );

  // Reflect workspace switches (`switchWorkspace` resets these) into local state.
  // Uses React's documented "reset state when a prop changes" pattern (compare
  // previous value during render) instead of an effect to avoid cascading
  // renders. See https://react.dev/reference/react/useState#storing-information-from-previous-renders
  const [prevWorkspaceId, setPrevWorkspaceId] = useState(workspace?.id);
  if (workspace?.id !== prevWorkspaceId) {
    setPrevWorkspaceId(workspace?.id);
    setSidebarWidth(workspace?.window_state?.sidebar_width ?? DEFAULT_SIDEBAR_WIDTH);
    setReqPanelPct(
      workspace?.window_state?.request_panel_height ?? DEFAULT_REQUEST_PANEL_PCT,
    );
  }

  useEffect(() => {
    initialize();
  }, [initialize]);

  // Listen for WS events from the Rust backend
  useEffect(() => {
    const unlistenPromise = listen<WsEvent>("ws-event", (event) => {
      const { request_id, kind, text } = event.payload;
      useRequestStore.getState().appendWsEvent(request_id, kind, text);
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  // Listen for SSE events from the Rust backend
  useEffect(() => {
    const unlistenPromise = listen<SseBackendEvent>("sse-event", (event) => {
      const { request_id, kind, event: evtName, data, id, retry, error } = event.payload;
      useRequestStore.getState().appendSseEvent(request_id, kind, {
        event: evtName,
        data,
        id,
        retry,
        error,
      });
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  // Global keyboard shortcuts
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const isMeta = e.metaKey || e.ctrlKey;

    // Cmd+Enter: Send request
    if (isMeta && e.key === "Enter") {
      e.preventDefault();
      useRequestStore.getState().sendRequest();
      return;
    }

    // Cmd+P / Cmd+K: Open search palette
    if (isMeta && (e.key === "p" || e.key === "k")) {
      e.preventDefault();
      setPaletteOpen(true);
      return;
    }

    // Cmd+N or Cmd+T: New request / tab
    if (isMeta && (e.key === "n" || e.key === "t")) {
      e.preventDefault();
      useRequestStore.getState().createNewRequest();
      return;
    }

    // Cmd+W: Close active tab
    if (isMeta && e.key === "w") {
      e.preventDefault();
      const { activeTabId } = useRequestStore.getState();
      if (activeTabId) useRequestStore.getState().closeTab(activeTabId);
      return;
    }

    // Cmd+L: Focus URL bar
    if (isMeta && e.key === "l") {
      e.preventDefault();
      const urlInput = document.querySelector<HTMLInputElement>('input[placeholder*="api.example.com"]');
      urlInput?.focus();
      urlInput?.select();
      return;
    }

    // Cmd+[ / Cmd+]: prev / next tab (and Shift+Cmd+Tab / Cmd+Tab on platforms
    // where the browser doesn't reserve those — covered here for parity with
    // the rest of the Cmd+bracket family).
    if (isMeta && (e.key === "[" || e.key === "]")) {
      e.preventDefault();
      useRequestStore.getState().cycleTab(e.key === "]" ? 1 : -1);
      return;
    }

    // Cmd+D: duplicate the active tab.
    if (isMeta && e.key === "d") {
      e.preventDefault();
      useRequestStore.getState().duplicateActiveTab();
      return;
    }

    // Cmd+,: open the Settings panel. The panel itself lives in the Sidebar,
    // which subscribes to this custom event in `useEffect`.
    if (isMeta && e.key === ",") {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent("api-client:open-settings"));
      return;
    }

    // Cmd+S: save the active tab to its collection. If the tab already
    // came from a collection we update it in place; otherwise we open the
    // SaveToCollectionModal so the user can pick a destination.
    if (isMeta && e.key === "s") {
      e.preventDefault();
      const { activeRequest: req, saveActiveRequest } = useRequestStore.getState();
      if (!req) return;
      if (req.collectionId) {
        // Await + catch so a backend save failure isn't silently swallowed
        // as an unhandled promise rejection. On error we re-open the picker
        // with the error message pre-populated so the user can pick a
        // different destination or just see what went wrong.
        saveActiveRequest()
          .then((ok) => {
            if (!ok) {
              setSaveErrorMessage(i18n.t("save_collection.stale_collection"));
              setSavePickerOpen(true);
            }
          })
          .catch((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.error("Failed to save request:", err);
            setSaveErrorMessage(msg);
            setSavePickerOpen(true);
          });
      } else {
        setSavePickerOpen(true);
      }
      return;
    }

    // Cmd+F: open the search palette (parity with Cmd+P / Cmd+K).
    if (isMeta && e.key === "f") {
      e.preventDefault();
      setPaletteOpen(true);
      return;
    }

    // Escape: Cancel request
    if (e.key === "Escape") {
      const { loading } = useRequestStore.getState();
      if (loading) {
        e.preventDefault();
        useRequestStore.getState().cancelRequest();
      }
      return;
    }
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  if (!initialized) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-bg">
        <div className="flex flex-col items-center gap-3">
          <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <span className="text-[13px] text-text-tertiary">Loading...</span>
        </div>
      </div>
    );
  }

  const protocol = activeRequest?.protocol;
  const isWs = protocol === "websocket";
  const isSse = protocol === "sse";

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg">
      <div style={{ width: sidebarWidth }} className="shrink-0 h-full">
        <Sidebar />
      </div>
      <Splitter
        orientation="horizontal"
        initial={sidebarWidth}
        min={180}
        max={520}
        onChange={setSidebarWidth}
        onCommit={(v) => setWindowState({ sidebar_width: Math.round(v) })}
      />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TabBar />
        <div className="flex-1 flex flex-col gap-0 p-3 pl-0 h-full">
          <div
            className="bg-surface rounded-t-apple-lg shadow-apple overflow-hidden flex flex-col"
            style={{ height: `${reqPanelPct}%` }}
          >
            <RequestPanel />
          </div>
          <Splitter
            orientation="vertical"
            initial={reqPanelPct}
            min={20}
            max={80}
            onChange={setReqPanelPct}
            onCommit={(v) => setWindowState({ request_panel_height: Math.round(v) })}
          />
          <div className="bg-surface rounded-b-apple-lg shadow-apple overflow-hidden flex-1 flex flex-col border-t border-border-light">
            {isWs ? <WsPanel /> : isSse ? <SsePanel /> : <ResponsePanel />}
          </div>
        </div>
      </div>
      {paletteOpen && <SearchPalette onClose={() => setPaletteOpen(false)} />}
      {savePickerOpen && (
        <SaveToCollectionModal
          initialError={saveErrorMessage}
          onClose={() => {
            setSavePickerOpen(false);
            setSaveErrorMessage(null);
          }}
          onSaved={() => {
            setSavePickerOpen(false);
            setSaveErrorMessage(null);
          }}
        />
      )}
    </div>
  );
}

export default App;
