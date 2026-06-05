import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Plus,
  Trash2,
  X,
  Globe,
  Check,
  Copy,
  Download,
  Upload,
  Search as SearchIcon,
} from "lucide-react";
import { useRequestStore } from "../store/useRequestStore";
import { VariablesEditor } from "./VariablesEditor";
import { ConfirmDialog } from "./ConfirmDialog";
import type { EnvVariable } from "../types";
import {
  downloadEnvironmentJson,
  parseImportFile,
} from "../utils/envIo";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/** Show the search box once the env list crosses this length — it'd just
 *  be noise for a workspace with a handful of environments. */
const SEARCH_THRESHOLD = 5;

/** Flatten a list of EnvVariables into a `{ key: value }` map for preview
 *  resolution. Disabled / blank-keyed rows are skipped — they wouldn't
 *  contribute at send time either. */
function toLookup(vars: EnvVariable[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!vars) return out;
  for (const v of vars) {
    if (v.enabled && v.key) out[v.key] = v.value;
  }
  return out;
}

/**
 * Full environment manager. Left column lists environments (with the active
 * one badged); right column edits the selected environment's variables via
 * the shared {@link VariablesEditor}.
 *
 * The shell is intentionally sized to `min(1024px, 92vw)` × `85vh` so the
 * variable rows have enough room for real-world token / URL values without
 * truncating. The narrow legacy 640 × 80vh layout couldn't fit a JWT.
 */
export function EnvironmentPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const {
    environments,
    workspace,
    addEnvironment,
    deleteEnvironment,
    updateEnvironment,
    setActiveEnvironment,
  } = useRequestStore();

  const [newEnvName, setNewEnvName] = useState("");
  const [search, setSearch] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editingEnvId, setEditingEnvId] = useState<string | null>(
    environments.length > 0 ? environments[0].id : null,
  );
  // null when no confirmation pending; otherwise the env id queued for delete.
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const filteredEnvironments = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return environments;
    return environments.filter((e) => e.name.toLowerCase().includes(q));
  }, [environments, search]);

  const showSearch = environments.length > SEARCH_THRESHOLD;

  const activeEnvId = workspace?.active_environment_id;
  const editingEnv = environments.find((e) => e.id === editingEnvId);
  const pendingDeleteEnv = environments.find((e) => e.id === pendingDeleteId);

  // Preview map shows the user what `{{otherVar}}` resolves to while they
  // edit. We layer the currently-edited env on top of workspace globals so
  // the precedence matches what `buildScopedVars` would produce when the
  // env is active. Folder / collection scopes aren't relevant here — the
  // env editor isn't bound to a specific request.
  const previewVars = useMemo<Record<string, string>>(
    () => ({
      ...toLookup(workspace?.variables),
      ...toLookup(editingEnv?.variables),
    }),
    [workspace?.variables, editingEnv?.variables],
  );

  const handleAddEnv = async () => {
    const name = newEnvName.trim();
    if (!name) return;
    await addEnvironment(name);
    setNewEnvName("");
    // Select the newly-created env so the user can immediately edit it.
    const updated = useRequestStore.getState().environments;
    const created = updated[updated.length - 1];
    if (created) setEditingEnvId(created.id);
  };

  const handleConfirmDelete = async () => {
    if (!pendingDeleteId) return;
    await deleteEnvironment(pendingDeleteId);
    if (editingEnvId === pendingDeleteId) setEditingEnvId(null);
    setPendingDeleteId(null);
  };

  /**
   * Create a new env with the given name + variables. Reuses
   * `addEnvironment` + `updateEnvironment` so we don't have to expose a
   * new store action just for duplicate / import. Returns the new env id
   * if creation succeeded, so the caller can select it.
   */
  const createWithVariables = async (
    name: string,
    variables: EnvVariable[],
  ): Promise<string | null> => {
    await addEnvironment(name);
    const all = useRequestStore.getState().environments;
    const created = all[all.length - 1];
    if (!created) return null;
    if (variables.length > 0) {
      await updateEnvironment({ ...created, variables });
    }
    return created.id;
  };

  const handleDuplicate = async (sourceId: string) => {
    const src = environments.find((e) => e.id === sourceId);
    if (!src) return;
    const newId = await createWithVariables(
      `${src.name} (copy)`,
      src.variables.map((v) => ({ ...v })),
    );
    if (newId) setEditingEnvId(newId);
  };

  const handleExport = (envId: string) => {
    const env = environments.find((e) => e.id === envId);
    if (!env) return;
    downloadEnvironmentJson(env.name, env.variables);
  };

  const handleImportClick = () => {
    setImportError(null);
    fileInputRef.current?.click();
  };

  const handleImportFile = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    // Reset the input so re-picking the same file fires `onChange` again.
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseImportFile(text);
      if (parsed.length === 0) {
        setImportError(t("env.import_error_empty"));
        return;
      }
      let lastId: string | null = null;
      for (const item of parsed) {
        lastId = await createWithVariables(item.name, item.variables);
      }
      if (lastId) setEditingEnvId(lastId);
      setImportError(null);
    } catch (err) {
      const code = err instanceof Error ? err.message : "unrecognised_format";
      setImportError(
        code === "invalid_json"
          ? t("env.import_error_invalid_json")
          : t("env.import_error_unrecognised"),
      );
    }
  };

  // Portal to <body> so we escape the sidebar's `backdrop-blur-xl`
  // containing block. Without the portal, the `position: fixed` modal
  // is sized to the sidebar's bounding box (~256px wide) and renders
  // visibly clipped — the exact "display incomplete" bug we're fixing.
  return (
    <>
      <Dialog
        open
        onOpenChange={(next) => {
          if (!next) onClose();
        }}
      >
        <DialogContent className="flex h-[85vh] max-h-[85vh] w-[92vw] max-w-[1024px] flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b border-border px-5 py-4 pr-12 text-left">
            <DialogTitle className="flex items-center gap-2 text-[15px]">
              <Globe size={18} className="text-primary" />
              {t("env.panel_title")}
            </DialogTitle>
          </DialogHeader>

        <div className="flex flex-1 overflow-hidden">
          {/* Env list */}
          <div className="w-60 shrink-0 border-r border-border flex flex-col overflow-hidden">
            {showSearch && (
              <div className="p-2 border-b border-border shrink-0">
                <div className="relative">
                  <SearchIcon
                    size={12}
                    className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                  />
                  <Input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t("env.search_placeholder")}
                    className="h-7 w-full pl-7 pr-7 text-[12px]"
                  />
                  {search && (
                    <button
                      type="button"
                      onClick={() => setSearch("")}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-muted"
                      title={t("common.clear")}
                    >
                      <X size={11} className="text-muted-foreground" />
                    </button>
                  )}
                </div>
              </div>
            )}
            <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
              {environments.length === 0 && (
                <p className="text-[12px] text-muted-foreground italic px-2 py-3">
                  {t("env.empty_list")}
                </p>
              )}
              {environments.length > 0 && filteredEnvironments.length === 0 && (
                <p className="text-[12px] text-muted-foreground italic px-2 py-3">
                  {t("env.no_search_results")}
                </p>
              )}
              {filteredEnvironments.map((env) => {
                const isActive = activeEnvId === env.id;
                const isSelected = editingEnvId === env.id;
                return (
                  <div
                    key={env.id}
                    onClick={() => setEditingEnvId(env.id)}
                    title={env.name}
                    className={`group flex items-center gap-1 px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors ${
                      isSelected
                        ? "bg-primary/10"
                        : "hover:bg-muted"
                    }`}
                  >
                    <span className="text-[12px] text-foreground truncate flex-1 min-w-0">
                      {env.name}
                    </span>
                    <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                      {env.variables.length}
                    </span>
                    {isActive && (
                      <Check size={12} className="text-success shrink-0" />
                    )}
                    <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDuplicate(env.id);
                        }}
                        className="p-0.5 hover:bg-primary/10 rounded"
                        title={t("env.duplicate_env_tooltip")}
                      >
                        <Copy size={11} className="text-muted-foreground" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleExport(env.id);
                        }}
                        className="p-0.5 hover:bg-primary/10 rounded"
                        title={t("env.export_env_tooltip")}
                      >
                        <Download size={11} className="text-muted-foreground" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setPendingDeleteId(env.id);
                        }}
                        className="p-0.5 hover:bg-destructive/10 rounded"
                        title={t("env.delete_env_tooltip")}
                      >
                        <Trash2 size={11} className="text-destructive/70" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="p-2 border-t border-border space-y-1">
              {importError && (
                <p
                  className="text-[11px] text-destructive px-1 break-words"
                  role="alert"
                >
                  {importError}
                </p>
              )}
              <div className="flex items-center gap-1">
                <Input
                  type="text"
                  value={newEnvName}
                  onChange={(e) => setNewEnvName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddEnv()}
                  placeholder={t("env.new_env_placeholder")}
                  className="h-7 min-w-0 flex-1 text-[12px]"
                />
                <button
                  onClick={handleAddEnv}
                  disabled={!newEnvName.trim()}
                  className="p-1.5 hover:bg-primary/10 rounded-md transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
                  title={t("env.add_env_tooltip")}
                >
                  <Plus size={13} className="text-primary" />
                </button>
                <button
                  onClick={handleImportClick}
                  className="p-1.5 hover:bg-primary/10 rounded-md transition-colors text-muted-foreground hover:text-primary"
                  title={t("env.import_env_tooltip")}
                >
                  <Upload size={13} />
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json"
                  onChange={handleImportFile}
                  className="hidden"
                  // Allow Postman exports that bundle multiple envs:
                  // we'll iterate inside handleImportFile.
                />
              </div>
            </div>
          </div>

          {/* Variables editor */}
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            {editingEnv ? (
              <>
                <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="text-[13px] font-medium text-foreground truncate"
                      title={editingEnv.name}
                    >
                      {editingEnv.name}
                    </span>
                    <span className="text-[11px] text-muted-foreground shrink-0">
                      {t("env.variable_count", {
                        count: editingEnv.variables.length,
                      })}
                    </span>
                  </div>
                  <button
                    onClick={() =>
                      setActiveEnvironment(
                        activeEnvId === editingEnv.id ? null : editingEnv.id,
                      )
                    }
                    className={`text-[11px] font-medium px-3 py-1 rounded-md transition-colors shrink-0 ${
                      activeEnvId === editingEnv.id
                        ? "bg-success/15 text-success"
                        : "bg-primary/10 text-primary hover:bg-primary/20"
                    }`}
                  >
                    {activeEnvId === editingEnv.id
                      ? t("env.active_badge")
                      : t("env.set_active")}
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-4">
                  <VariablesEditor
                    value={editingEnv.variables}
                    onChange={(next) =>
                      updateEnvironment({ ...editingEnv, variables: next })
                    }
                    emptyHint={t("env.no_variables_in_env")}
                    previewVars={previewVars}
                  />
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-muted-foreground text-[12px]">
                {t("env.select_or_create")}
              </div>
            )}
          </div>
        </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pendingDeleteEnv !== undefined}
        title={t("env.delete_env_title")}
        message={t("env.delete_env_message", {
          name: pendingDeleteEnv?.name ?? "",
        })}
        confirmLabel={t("common.delete")}
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDeleteId(null)}
      />
    </>
  );
}
