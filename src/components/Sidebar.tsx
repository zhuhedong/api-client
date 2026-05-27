import { useState, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  Plus,
  Clock,
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
  History,
  FileText,
} from "lucide-react";
import { useRequestStore } from "../store/useRequestStore";
import { EnvironmentPanel } from "./EnvironmentPanel";
import { CookiesPanel } from "./CookiesPanel";
import { SettingsPanel } from "./SettingsPanel";
import { collectionToPostman, postmanToCollection } from "../utils/postman";
import { openapiToCollection } from "../utils/openapi";
import { insomniaToCollections } from "../utils/insomnia";
import { harToCollection } from "../utils/har";
import { httpFileToCollection } from "../utils/http-file";
import { CollectionAuthModal } from "./CollectionAuthModal";
import { CollectionRunnerModal } from "./CollectionRunnerModal";
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

const METHOD_BADGE: Record<string, string> = {
  GET: "bg-success/15 text-success",
  POST: "bg-orange/15 text-orange",
  PUT: "bg-accent/15 text-accent",
  PATCH: "bg-purple/15 text-purple",
  DELETE: "bg-error/15 text-error",
  HEAD: "bg-text-tertiary/15 text-text-secondary",
  OPTIONS: "bg-text-tertiary/15 text-text-secondary",
};

/** Format an epoch-ms timestamp as a coarse relative-time string. Used by
 *  the Recent Opened list — exact timestamps would clutter the sidebar
 *  and minute-level precision is rarely useful here. */
function formatRelativeTime(ts: number, t: (k: string, opts?: Record<string, unknown>) => string): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return t("time.just_now");
  if (diffSec < 3600) return t("time.minutes_ago", { n: Math.floor(diffSec / 60) });
  if (diffSec < 86400) return t("time.hours_ago", { n: Math.floor(diffSec / 3600) });
  return t("time.days_ago", { n: Math.floor(diffSec / 86400) });
}

export function Sidebar() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<"history" | "collections" | "recent">("history");
  const [searchQuery, setSearchQuery] = useState("");
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
  const [variableScope, setVariableScope] = useState<
    { kind: "global" } | { kind: "collection"; collectionId: string } | null
  >(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // `dark` is driven by the central `useDarkMode` observer so anything else
  // that changes the theme (Settings panel, future system listeners, etc.)
  // keeps this toggle in sync without manual wiring.
  const dark = useDarkMode();
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
    history,
    collections,
    environments,
    workspace,
    recentItems,
    createNewRequest,
    loadFromHistory,
    deleteRequestFromHistory,
    clearAllHistory,
    searchHistory,
    addCollection,
    deleteCollection,
    renameCollection,
    addRequestToCollection,
    loadRequestFromCollection,
    reorderHistory,
    reorderCollections,
    importPostmanCollection,
    importCollections,
    setActiveEnvironment,
    activeRequestId,
    clearRecent,
    refreshRecent,
  } = useRequestStore();

  // Refresh the recents list when the tab is switched on so the user sees
  // entries recorded in other workspaces / windows.
  useEffect(() => {
    if (activeTab === "recent") {
      refreshRecent();
    }
  }, [activeTab, refreshRecent]);

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    if (query.trim()) {
      searchHistory(query.trim());
    } else {
      useRequestStore.getState().initialize();
    }
  };

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

  const exportPostman = (colId: string) => {
    const col = collections.find((c) => c.id === colId);
    if (!col) return;
    const data = collectionToPostman(col);
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${col.name.replace(/[^a-z0-9-_ ]/gi, "_")}.postman_collection.json`;
    a.click();
    URL.revokeObjectURL(url);
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
          <div>
            {/* Search bar */}
            <div className="px-0.5 pb-2">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => handleSearch(e.target.value)}
                  placeholder={t("common.search") + "…"}
                  className="input-apple w-full text-[12px] py-[5px] pl-8 pr-7"
                />
                {searchQuery && (
                  <button
                    onClick={() => handleSearch("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-secondary"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-0.5">
              {history.length === 0 && (
                <div className="text-center py-12">
                  <Clock size={28} className="mx-auto text-text-tertiary mb-2" strokeWidth={1.5} />
                  <p className="text-text-tertiary text-[12px]">
                    {searchQuery ? "No results found" : "No requests yet"}
                  </p>
                </div>
              )}
              {history.map((item) => (
                <div
                  key={item.id}
                  draggable
                  onDragStart={() => setDraggingId(item.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (draggingId) reorderHistory(draggingId, item.id);
                    setDraggingId(null);
                  }}
                  onDragEnd={() => setDraggingId(null)}
                  className={`group flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg hover:bg-black/[0.04] active:bg-black/[0.06] cursor-pointer transition-colors ${activeRequestId === item.id ? "bg-accent/[0.07]" : ""}`}
                  onClick={() => loadFromHistory(item.id)}
                >
                  <span
                    className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md shrink-0 ${METHOD_BADGE[item.method] || ""}`}
                  >
                    {item.method}
                  </span>
                  <span className="text-[12px] text-text-secondary truncate flex-1">
                    {(() => {
                      try { return new URL(item.url).pathname; } catch { return item.url || "Untitled"; }
                    })()}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteRequestFromHistory(item.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-error/10 rounded-md transition-all"
                  >
                    <Trash2 size={12} className="text-error/70" />
                  </button>
                </div>
              ))}
            </div>

            {history.length > 0 && !searchQuery && (
              <button
                onClick={() => clearAllHistory()}
                className="mt-3 w-full text-center text-[11px] text-text-tertiary hover:text-error transition-colors py-1.5"
              >
                Clear All History
              </button>
            )}
          </div>
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
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        exportPostman(collection.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-accent/10 rounded-md transition-all"
                      title="Export as Postman v2.1"
                    >
                      <Download size={11} className="text-text-tertiary" />
                    </button>
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

        {activeTab === "recent" && (
          <div className="space-y-0.5">
            {recentItems.length === 0 ? (
              <div className="text-center py-12">
                <History size={28} className="mx-auto text-text-tertiary mb-2" strokeWidth={1.5} />
                <p className="text-text-tertiary text-[12px]">{t("sidebar.recent_empty")}</p>
              </div>
            ) : (
              <>
                {recentItems.map((item) => {
                  const onClick = () => {
                    if (item.item_type === "request") {
                      // Items are stored as either "<collectionId>:<requestId>"
                      // (recordRecent from loadRequestFromCollection) or
                      // "history:<id>" (recordRecent from loadFromHistory).
                      // Anything else is a legacy/external row and we just
                      // skip it.
                      const [scope, ...rest] = item.item_id.split(":");
                      const rest_id = rest.join(":");
                      if (scope === "history") {
                        loadFromHistory(rest_id);
                      } else if (scope && rest_id) {
                        loadRequestFromCollection(scope, rest_id);
                      }
                    }
                  };
                  return (
                    <div
                      key={item.id}
                      className="group flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg hover:bg-black/[0.04] active:bg-black/[0.06] cursor-pointer transition-colors"
                      onClick={onClick}
                    >
                      <FileText
                        size={13}
                        className="shrink-0 text-text-tertiary"
                        strokeWidth={1.75}
                      />
                      <span className="text-[12px] text-text-secondary truncate flex-1">
                        {item.name || t("common.untitled")}
                      </span>
                      <span className="text-[10px] text-text-tertiary shrink-0">
                        {formatRelativeTime(item.opened_at, t)}
                      </span>
                    </div>
                  );
                })}
                <button
                  onClick={() => clearRecent()}
                  className="mt-3 w-full text-center text-[11px] text-text-tertiary hover:text-error transition-colors py-1.5"
                >
                  {t("sidebar.recent_clear")}
                </button>
              </>
            )}
          </div>
        )}
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
