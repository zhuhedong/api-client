import { useState, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  Plus,
  FolderOpen,
  Trash2,
  FolderPlus,
  Search,
  X,
  Moon,
  Sun,
  Pencil,
  Globe,
  Cookie,
  Settings as SettingsIcon,
  Upload,
  Download,
  ChevronDown,
  KeyRound,
  Play,
  Braces,
  Server,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useRequestStore } from "../store/useRequestStore";
import { EnvironmentPanel } from "./EnvironmentPanel";
import { CookiesPanel } from "./CookiesPanel";
import { SettingsPanel } from "./SettingsPanel";
import { collectionToPostman, postmanToCollection } from "../utils/postman";
import { openapiToCollection, exportOpenApi, openApiToMockRoutes } from "../utils/openapi";
import { insomniaToCollections } from "../utils/insomnia";
import { harToCollection } from "../utils/har";
import { httpFileToCollection } from "../utils/http-file";
import { CollectionAuthModal } from "./CollectionAuthModal";
import { CollectionRunnerModal } from "./CollectionRunnerModal";
import { SidebarHistoryTab } from "./SidebarHistoryTab";
import { SidebarRecentTab } from "./SidebarRecentTab";
import { VariableScopeModal } from "./VariableScopeModal";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { MockServerPanel } from "./MockServerPanel";
import { ConfirmDialog } from "./ConfirmDialog";
import { CollectionTreeView } from "./CollectionTree";
import { setThemeMode } from "../utils/theme";
import { useDarkMode } from "../utils/useDarkMode";

/** Heuristic format sniffers used by `handleImportFile`. */
function isHar(d: unknown): boolean {
  const r = d as { log?: { version?: unknown; entries?: unknown } } | null;
  return !!r && typeof r.log === "object" && Array.isArray(r.log?.entries);
}
function isOpenApi(d: unknown): boolean {
  const r = d as { openapi?: string; swagger?: string; paths?: unknown } | null;
  return !!r && (typeof r.openapi === "string" || typeof r.swagger === "string") && typeof r.paths === "object";
}
function isInsomnia(d: unknown): boolean {
  const r = d as { _type?: string; resources?: unknown } | null;
  return !!r && r._type === "export" && Array.isArray(r.resources);
}
function isPostman(d: unknown): boolean {
  const r = d as { info?: { schema?: string } } | null;
  return !!r && typeof r.info?.schema === "string" && r.info.schema.includes("postman");
}

export function Sidebar() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<"history" | "collections" | "recent">("history");
  // History search query lives here — not inside SidebarHistoryTab — so
  // that switching to another tab and back doesn't clear the input
  // while the store-level `history` array is still filtered (which
  // would render an empty search box over a filtered list).
  const [historySearchQuery, setHistorySearchQuery] = useState("");
  const [showNewCollection, setShowNewCollection] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [showEnvPanel, setShowEnvPanel] = useState(false);
  const [showCookies, setShowCookies] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showMockServer, setShowMockServer] = useState(false);
  const [renamingCollection, setRenamingCollection] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deletingCollection, setDeletingCollection] = useState<{ id: string; name: string } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [showEnvDropdown, setShowEnvDropdown] = useState(false);
  const [envSearch, setEnvSearch] = useState("");
  const [editingAuthCollectionId, setEditingAuthCollectionId] = useState<string | null>(null);
  const [runnerCollectionId, setRunnerCollectionId] = useState<string | null>(null);
  /** id of the collection whose export-format dropdown is currently open, or null. */
  const [exportMenuColId, setExportMenuColId] = useState<string | null>(null);
  const [variableScope, setVariableScope] = useState<
    { kind: "global" } | { kind: "collection"; collectionId: string } | null
  >(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // `dark` is driven by the central `useDarkMode` observer so anything else
  // that changes the theme (Settings panel, future system listeners, etc.)
  // keeps this toggle in sync without manual wiring.
  const dark = useDarkMode();
  // Drag-to-reorder state for the Collections tab. History has its own
  // local instance inside SidebarHistoryTab — keeping them separate so
  // dragging a history row doesn't also try to reorder a collection.
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const toggleDark = () => {
    // Toggle promotes the choice to an explicit mode (so the user's intent
    // beats their OS setting), which the Settings panel's "Theme" dropdown
    // can later flip back to "system" if they want.
    setThemeMode(dark ? "light" : "dark");
  };

  // Close the environment dropdown when clicking outside of it
  useEffect(() => {
    if (!showEnvDropdown) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-env-dropdown]")) {
        setShowEnvDropdown(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [showEnvDropdown]);

  // Bridge for the global Cmd/Ctrl+, shortcut: App.tsx dispatches this event
  // so any panel that owns modal state can react. Keeping the dispatch path
  // event-based avoids hoisting `showSettings` into the store.
  useEffect(() => {
    const onOpenSettings = () => setShowSettings(true);
    window.addEventListener("api-client:open-settings", onOpenSettings);
    return () => window.removeEventListener("api-client:open-settings", onOpenSettings);
  }, []);

  const {
    collections,
    environments,
    workspace,
    createNewRequest,
    addCollection,
    deleteCollection,
    renameCollection,
    addRequestToCollection,
    reorderCollections,
    importPostmanCollection,
    importCollections,
    setActiveEnvironment,
    activeRequestId,
    refreshRecent,
  } = useRequestStore();

  // Refresh the recents list when the tab is switched on so the user sees
  // entries recorded in other workspaces / windows.
  useEffect(() => {
    if (activeTab === "recent") {
      refreshRecent();
    }
  }, [activeTab, refreshRecent]);

  // Reset the history filter when the workspace changes. `switchWorkspace`
  // replaces the store's `history` array with the new workspace's full
  // (unfiltered) history, but the search input is React local state and
  // would otherwise keep showing the previous workspace's query —
  // leaving the user with a stale "foo" in the box over an unfiltered
  // list of the new workspace.
  //
  // Using the prev-ref pattern from
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  // rather than a useEffect — eslint's `react-hooks/set-state-in-effect`
  // rule (correctly) flags the useEffect form as a cascading-render
  // anti-pattern.
  const prevWorkspaceIdRef = useRef(workspace?.id);
  if (prevWorkspaceIdRef.current !== workspace?.id) {
    prevWorkspaceIdRef.current = workspace?.id;
    setHistorySearchQuery("");
  }

  const handleAddCollection = async () => {
    const name = newCollectionName.trim();
    if (!name) return;
    await addCollection(name);
    setNewCollectionName("");
    setShowNewCollection(false);
  };

  const startRenameCollection = (id: string, currentName: string) => {
    setRenamingCollection(id);
    setRenameValue(currentName);
  };

  const commitRenameCollection = async () => {
    const n = renameValue.trim();
    if (renamingCollection && n) {
      await renameCollection(renamingCollection, n);
    }
    setRenamingCollection(null);
    setRenameValue("");
  };

  const activeEnv = environments.find((e) => e.id === workspace?.active_environment_id);

  /**
   * Auto-detect the import format from the file name and contents. We try in
   * descending order of specificity so e.g. an OpenAPI YAML doesn't get
   * misclassified as a Postman JSON.
   */
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const name = file.name.toLowerCase();

      if (name.endsWith(".http") || name.endsWith(".rest")) {
        await importCollections([httpFileToCollection(text, file.name)]);
      } else if (name.endsWith(".yaml") || name.endsWith(".yml")) {
        await importCollections([openapiToCollection(text)]);
      } else {
        // JSON-based formats: sniff the contents.
        const data = JSON.parse(text);
        if (isHar(data)) {
          await importCollections([harToCollection(data)]);
        } else if (isOpenApi(data)) {
          await importCollections([openapiToCollection(data)]);
        } else if (isInsomnia(data)) {
          await importCollections(insomniaToCollections(data));
        } else if (isPostman(data)) {
          await importPostmanCollection(data);
        } else {
          // Fall back to Postman so legacy files still work — postmanToCollection
          // is lenient enough to wrap any item-shaped object.
          await importCollections(postmanToCollection(data));
        }
      }
    } catch (err) {
      setImportError(String(err));
    } finally {
      e.target.value = "";
    }
  };

  const downloadAsFile = (filename: string, content: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPostman = (colId: string) => {
    const col = collections.find((c) => c.id === colId);
    if (!col) return;
    const json = JSON.stringify(collectionToPostman(col), null, 2);
    const safe = col.name.replace(/[^a-z0-9-_ ]/gi, "_");
    downloadAsFile(`${safe}.postman_collection.json`, json, "application/json");
  };

  const exportAsOpenApi = (colId: string) => {
    const col = collections.find((c) => c.id === colId);
    if (!col) return;
    const safe = col.name.replace(/[^a-z0-9-_ ]/gi, "_");
    downloadAsFile(`${safe}.openapi.json`, exportOpenApi(col), "application/json");
  };

  const generateMocksFromOpenApi = async (colId: string) => {
    const col = collections.find((c) => c.id === colId);
    if (!col || !workspace?.id) return;
    // Export this collection to OpenAPI in memory, then derive mock routes
    // from the result. The user sees the new mocks immediately in the Mock
    // Server panel.
    const spec = exportOpenApi(col);
    const routes = openApiToMockRoutes(spec);
    for (const route of routes) {
      await invoke("save_mock_route", { workspaceId: workspace.id, route });
    }
    setShowMockServer(true);
  };

  return (
    <div className="w-full bg-sidebar backdrop-blur-xl border-r border-border-light flex flex-col h-full">
      {/* Drag region + title */}
      <div className="pt-5 px-4 pb-3">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-[15px] font-semibold text-text-primary tracking-tight">API Client</h1>
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => setShowCookies(true)}
              className="relative z-10 w-7 h-7 flex items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10 active:scale-95 transition-all cursor-pointer"
              title={t("sidebar.cookies")}
            >
              <Cookie size={14} className="text-text-secondary" />
            </button>
            <button
              onClick={() => setShowMockServer(true)}
              className="relative z-10 w-7 h-7 flex items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10 active:scale-95 transition-all cursor-pointer"
              title={t("sidebar.mock_server")}
            >
              <Server size={14} className="text-text-secondary" />
            </button>
            <button
              onClick={() => setShowSettings(true)}
              className="relative z-10 w-7 h-7 flex items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10 active:scale-95 transition-all cursor-pointer"
              title={t("settings.settings")}
            >
              <SettingsIcon size={14} className="text-text-secondary" />
            </button>
            <button
              onClick={toggleDark}
              className="relative z-10 w-7 h-7 flex items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10 active:scale-95 transition-all cursor-pointer"
              title={t(dark ? "sidebar.light_mode" : "sidebar.dark_mode")}
            >
              {dark ? <Sun size={14} className="text-text-secondary" /> : <Moon size={14} className="text-text-secondary" />}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                createNewRequest();
              }}
              className="relative z-10 w-7 h-7 flex items-center justify-center rounded-lg bg-accent/10 hover:bg-accent/20 active:scale-95 transition-all cursor-pointer"
              title={t("sidebar.new_request")}
            >
              <Plus size={15} className="text-accent" strokeWidth={2.2} />
            </button>
          </div>
        </div>

        {/* Workspace switcher */}
        <div className="mb-2">
          <WorkspaceSwitcher />
        </div>

        {/* Environment selector */}
        <div className="relative mb-3" data-env-dropdown>
          <button
            onClick={() => setShowEnvDropdown((v) => !v)}
            className="w-full flex items-center justify-between gap-1.5 px-2.5 py-1.5 bg-surface-secondary hover:bg-surface-secondary/70 rounded-lg text-[12px] text-text-secondary transition-colors"
          >
            <span className="flex items-center gap-1.5 truncate">
              <Globe size={12} className="text-accent shrink-0" />
              <span className="truncate">{activeEnv ? activeEnv.name : t("sidebar.no_active_environment")}</span>
            </span>
            <ChevronDown size={11} className="text-text-tertiary shrink-0" />
          </button>
          {showEnvDropdown && (
            // Decoupled from the trigger's width so longer env names + the
            // variable-count badge fit without truncating. Caps at 360px and
            // 70vh so it never overflows the viewport when many envs exist.
            <EnvDropdown
              environments={environments}
              activeEnvId={activeEnv?.id ?? null}
              search={envSearch}
              onSearchChange={setEnvSearch}
              onSelect={(id) => {
                setActiveEnvironment(id);
                setShowEnvDropdown(false);
              }}
            >
              <button
                onClick={() => {
                  setShowEnvPanel(true);
                  setShowEnvDropdown(false);
                }}
                className="block w-full text-left px-3 py-1.5 text-[12px] text-accent hover:bg-accent/10 transition-colors border-t border-border-light"
              >
                {t("sidebar.manage_environments")}
              </button>
              <button
                onClick={() => {
                  setVariableScope({ kind: "global" });
                  setShowEnvDropdown(false);
                }}
                className="block w-full text-left px-3 py-1.5 text-[12px] text-accent hover:bg-accent/10 transition-colors"
                title={t("sidebar.global_variables_tooltip")}
              >
                {t("sidebar.global_variables")}
              </button>
            </EnvDropdown>
          )}
        </div>

        {/* Segmented Control */}
        <div className="segmented-control w-full">
          <button
            onClick={() => setActiveTab("history")}
            className={`segment flex-1 ${activeTab === "history" ? "segment-active" : ""}`}
          >
            {t("sidebar.history")}
          </button>
          <button
            onClick={() => setActiveTab("collections")}
            className={`segment flex-1 ${activeTab === "collections" ? "segment-active" : ""}`}
          >
            {t("sidebar.collections")}
          </button>
          <button
            onClick={() => setActiveTab("recent")}
            className={`segment flex-1 ${activeTab === "recent" ? "segment-active" : ""}`}
          >
            {t("sidebar.recent")}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {activeTab === "history" && (
          <SidebarHistoryTab
            searchQuery={historySearchQuery}
            setSearchQuery={setHistorySearchQuery}
          />
        )}

        {activeTab === "collections" && (
          <div>
            {/* Add / import */}
            <div className="px-0.5 pb-2">
              {showNewCollection ? (
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={newCollectionName}
                    onChange={(e) => setNewCollectionName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddCollection();
                      if (e.key === "Escape") setShowNewCollection(false);
                    }}
                    placeholder="Collection name"
                    className="input-apple flex-1 text-[12px] py-[5px]"
                    autoFocus
                  />
                  <button
                    onClick={handleAddCollection}
                    className="text-[11px] text-accent font-medium px-2 py-1 hover:bg-accent/10 rounded-md transition-colors"
                  >
                    Add
                  </button>
                  <button
                    onClick={() => setShowNewCollection(false)}
                    className="p-1 hover:bg-black/5 rounded-md transition-colors"
                  >
                    <X size={12} className="text-text-tertiary" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => setShowNewCollection(true)}
                    className="flex items-center gap-1.5 text-[12px] text-accent hover:text-accent-hover transition-colors py-1"
                  >
                    <FolderPlus size={13} strokeWidth={2} />
                    New Collection
                  </button>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1 text-[11px] text-text-tertiary hover:text-accent transition-colors"
                    title="Import Postman / OpenAPI / Insomnia / HAR / .http file"
                  >
                    <Upload size={11} />
                    Import
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json,.yaml,.yml,.har,.http,.rest,application/json,text/yaml"
                    className="hidden"
                    onChange={handleImportFile}
                  />
                </div>
              )}
            </div>

            <div className="space-y-1">
              {collections.length === 0 && !showNewCollection && (
                <div className="text-center py-12">
                  <FolderOpen size={28} className="mx-auto text-text-tertiary mb-2" strokeWidth={1.5} />
                  <p className="text-text-tertiary text-[12px]">No collections yet</p>
                </div>
              )}
              {collections.map((collection) => (
                <div
                  key={collection.id}
                  draggable={!renamingCollection}
                  onDragStart={() => setDraggingId(collection.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (draggingId) reorderCollections(draggingId, collection.id);
                    setDraggingId(null);
                  }}
                  onDragEnd={() => setDraggingId(null)}
                >
                  <div className="group flex items-center gap-2 px-2.5 py-2 text-[11px] font-semibold text-text-tertiary uppercase tracking-wider">
                    <FolderOpen size={13} strokeWidth={1.8} />
                    {renamingCollection === collection.id ? (
                      <input
                        type="text"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={commitRenameCollection}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRenameCollection();
                          if (e.key === "Escape") {
                            setRenamingCollection(null);
                            setRenameValue("");
                          }
                        }}
                        className="flex-1 bg-surface text-text-primary px-1.5 py-0.5 rounded text-[11px] normal-case font-normal tracking-normal"
                        autoFocus
                      />
                    ) : (
                      <span
                        className="truncate flex-1"
                        onDoubleClick={() => startRenameCollection(collection.id, collection.name)}
                        title="Double-click to rename"
                      >
                        {collection.name}
                      </span>
                    )}
                    <span className="text-text-tertiary bg-surface-secondary px-1.5 py-0.5 rounded-md text-[10px]">
                      {collection.requests.length}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        startRenameCollection(collection.id, collection.name);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-accent/10 rounded-md transition-all"
                      title="Rename collection"
                    >
                      <Pencil size={11} className="text-text-tertiary" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingAuthCollectionId(collection.id);
                      }}
                      className={`opacity-0 group-hover:opacity-100 p-0.5 hover:bg-accent/10 rounded-md transition-all ${collection.auth && collection.auth.auth_type !== "none" ? "!opacity-100" : ""}`}
                      title={
                        collection.auth && collection.auth.auth_type !== "none"
                          ? `Edit collection auth (currently ${collection.auth.auth_type})`
                          : "Set collection auth (inherited by requests with 'Inherit')"
                      }
                    >
                      <KeyRound
                        size={11}
                        className={collection.auth && collection.auth.auth_type !== "none" ? "text-accent" : "text-text-tertiary"}
                      />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setVariableScope({ kind: "collection", collectionId: collection.id });
                      }}
                      className={`opacity-0 group-hover:opacity-100 p-0.5 hover:bg-accent/10 rounded-md transition-all ${collection.variables && collection.variables.length > 0 ? "!opacity-100" : ""}`}
                      title={
                        collection.variables && collection.variables.length > 0
                          ? `Edit collection variables (${collection.variables.length} defined)`
                          : "Set collection-scoped variables"
                      }
                    >
                      <Braces
                        size={11}
                        className={collection.variables && collection.variables.length > 0 ? "text-accent" : "text-text-tertiary"}
                      />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setRunnerCollectionId(collection.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-accent/10 rounded-md transition-all"
                      title="Run collection"
                    >
                      <Play size={11} className="text-text-tertiary" />
                    </button>
                    <div className="relative">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setExportMenuColId(exportMenuColId === collection.id ? null : collection.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-accent/10 rounded-md transition-all"
                        title={t("sidebar.export_collection")}
                      >
                        <Download size={11} className="text-text-tertiary" />
                      </button>
                      {exportMenuColId === collection.id && (
                        <div
                          className="absolute right-0 top-full mt-1 bg-bg-primary border border-border rounded-apple shadow-lg py-1 z-50 min-w-[180px]"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() => { exportPostman(collection.id); setExportMenuColId(null); }}
                            className="w-full text-left px-3 py-1.5 text-[12px] hover:bg-black/5 dark:hover:bg-white/10"
                          >
                            {t("sidebar.export_postman")}
                          </button>
                          <button
                            onClick={() => { exportAsOpenApi(collection.id); setExportMenuColId(null); }}
                            className="w-full text-left px-3 py-1.5 text-[12px] hover:bg-black/5 dark:hover:bg-white/10"
                          >
                            {t("sidebar.export_openapi")}
                          </button>
                          <div className="border-t border-border my-1" />
                          <button
                            onClick={() => { generateMocksFromOpenApi(collection.id); setExportMenuColId(null); }}
                            className="w-full text-left px-3 py-1.5 text-[12px] hover:bg-black/5 dark:hover:bg-white/10"
                          >
                            {t("sidebar.generate_mocks")}
                          </button>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeletingCollection({ id: collection.id, name: collection.name });
                      }}
                      className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-error/10 rounded-md transition-all"
                      title={t("common.delete")}
                    >
                      <Trash2 size={11} className="text-error/70" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        addRequestToCollection(collection.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-accent/10 rounded-md transition-all"
                      title="Save current request to collection"
                    >
                      <Plus size={11} className="text-accent" />
                    </button>
                  </div>
                  <CollectionTreeView
                    collection={collection}
                    activeRequestId={activeRequestId}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "recent" && <SidebarRecentTab />}
      </div>

      {showEnvPanel && <EnvironmentPanel onClose={() => setShowEnvPanel(false)} />}
      {showCookies && <CookiesPanel onClose={() => setShowCookies(false)} />}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
      {showMockServer && <MockServerPanel onClose={() => setShowMockServer(false)} />}
      <CollectionAuthModal
        collectionId={editingAuthCollectionId}
        onClose={() => setEditingAuthCollectionId(null)}
      />
      {runnerCollectionId && (
        <CollectionRunnerModal
          collectionId={runnerCollectionId}
          onClose={() => setRunnerCollectionId(null)}
        />
      )}
      <VariableScopeModal scope={variableScope} onClose={() => setVariableScope(null)} />
      <ConfirmDialog
        open={deletingCollection !== null}
        title={t("sidebar.delete_collection_title")}
        message={
          deletingCollection
            ? t("sidebar.delete_collection_message", { name: deletingCollection.name })
            : ""
        }
        onConfirm={() => {
          if (deletingCollection) {
            deleteCollection(deletingCollection.id);
          }
          setDeletingCollection(null);
        }}
        onCancel={() => setDeletingCollection(null)}
      />
      <ConfirmDialog
        open={importError !== null}
        title={t("sidebar.import_failed_title")}
        message={importError ? t("sidebar.import_failed_message", { error: importError }) : ""}
        confirmLabel={t("common.ok")}
        variant="primary"
        onConfirm={() => setImportError(null)}
        onCancel={() => setImportError(null)}
      />
    </div>
  );
}

/**
 * Pop-over list of environments shown under the sidebar env selector.
 * Extracted into its own component so the search-filter state has a clear
 * home and the parent `Sidebar` body stays readable. Children are appended
 * after the list (used for the "Manage environments" / "Global vars" links).
 */
function EnvDropdown({
  environments,
  activeEnvId,
  search,
  onSearchChange,
  onSelect,
  children,
}: {
  environments: ReturnType<typeof useRequestStore.getState>["environments"];
  activeEnvId: string | null;
  search: string;
  onSearchChange: (v: string) => void;
  onSelect: (id: string | null) => void;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();

  // Same threshold as the EnvironmentPanel — keep the dropdown clean when
  // the user only has a handful of environments.
  const showSearch = environments.length > 5;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return environments;
    return environments.filter((e) => e.name.toLowerCase().includes(q));
  }, [environments, search]);

  return (
    <div className="absolute top-full left-0 mt-1 w-[280px] max-w-[360px] max-h-[70vh] overflow-y-auto bg-surface rounded-apple shadow-apple-lg border border-border-light z-30">
      {showSearch && (
        <div className="sticky top-0 bg-surface border-b border-border-light p-1.5 z-10">
          <div className="relative">
            <Search
              size={11}
              className="absolute left-2 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={t("env.search_placeholder")}
              className="input-apple w-full text-[11px] py-1 pl-6 pr-6"
            />
            {search && (
              <button
                type="button"
                onClick={() => onSearchChange("")}
                className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-surface-secondary"
                title={t("common.clear")}
              >
                <X size={10} className="text-text-tertiary" />
              </button>
            )}
          </div>
        </div>
      )}
      <button
        onClick={() => onSelect(null)}
        className={`block w-full text-left px-3 py-1.5 text-[12px] hover:bg-surface-secondary transition-colors ${
          !activeEnvId ? "text-accent" : "text-text-secondary"
        }`}
      >
        {t("sidebar.no_active_environment")}
      </button>
      {environments.length > 0 && filtered.length === 0 && (
        <p className="text-[11px] text-text-tertiary italic px-3 py-2">
          {t("env.no_search_results")}
        </p>
      )}
      {filtered.map((env) => (
        <button
          key={env.id}
          onClick={() => onSelect(env.id)}
          title={env.name}
          className={`flex items-center w-full px-3 py-1.5 text-[12px] hover:bg-surface-secondary transition-colors ${
            env.id === activeEnvId ? "text-accent" : "text-text-primary"
          }`}
        >
          <span className="flex-1 min-w-0 truncate text-left">{env.name}</span>
          <span className="ml-2 shrink-0 text-[10px] text-text-tertiary tabular-nums">
            {env.variables.length}
          </span>
        </button>
      ))}
      {children}
    </div>
  );
}
