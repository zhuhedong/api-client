import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Globe, Folder } from "lucide-react";
import { useRequestStore } from "../store/useRequestStore";
import { VariablesEditor } from "./VariablesEditor";
import type { EnvVariable } from "../types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type Scope = { kind: "global" } | { kind: "collection"; collectionId: string };

interface Props {
  /** Which scope to edit. `null` closes the modal. */
  scope: Scope | null;
  onClose: () => void;
}

/**
 * Modal for editing the variable list of either the workspace (global
 * scope) or a specific collection. Folder-scope editing is not exposed
 * via UI in this PR — the backend supports it for future work.
 */
export function VariableScopeModal({ scope, onClose }: Props) {
  const { t } = useTranslation();
  const workspace = useRequestStore((s) => s.workspace);
  const collections = useRequestStore((s) => s.collections);
  const setGlobalVariables = useRequestStore((s) => s.setGlobalVariables);
  const setCollectionVariables = useRequestStore(
    (s) => s.setCollectionVariables,
  );

  const collection =
    scope?.kind === "collection"
      ? collections.find((c) => c.id === scope.collectionId) ?? null
      : null;

  // The "source of truth" variable list for the currently selected scope.
  const sourceVars: EnvVariable[] =
    scope?.kind === "global"
      ? workspace?.variables ?? []
      : collection?.variables ?? [];

  const [draft, setDraft] = useState<EnvVariable[]>(sourceVars);

  // Inline preview scope:
  //  - Global scope previews against just its own draft (nothing else is
  //    lower in the hierarchy).
  //  - Collection scope previews against (global ⊕ draft); folder / env
  //    scopes would shadow these at send time, but we don't have a
  //    specific request context here so the lowest meaningful layer wins.
  const previewVars = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    if (scope?.kind === "collection") {
      for (const v of workspace?.variables ?? []) {
        if (v.enabled && v.key) out[v.key] = v.value;
      }
    }
    for (const v of draft) {
      if (v.enabled && v.key) out[v.key] = v.value;
    }
    return out;
  }, [scope?.kind, workspace?.variables, draft]);

  // Reset the draft when the open scope or its source variables change. Uses
  // React's recommended "compare previous value during render" pattern instead
  // of useEffect to avoid a render-then-render cascade.
  const scopeKey =
    scope?.kind === "global"
      ? `global:${workspace?.id ?? ""}`
      : scope?.kind === "collection"
        ? `collection:${collection?.id ?? ""}`
        : "none";
  const [prevScopeKey, setPrevScopeKey] = useState(scopeKey);
  if (scopeKey !== prevScopeKey) {
    setPrevScopeKey(scopeKey);
    setDraft(sourceVars);
  }

  if (!scope) return null;
  if (scope.kind === "collection" && !collection) return null;

  const title =
    scope.kind === "global"
      ? t("variable_scope.global_title")
      : t("variable_scope.collection_title", { name: collection?.name ?? "" });
  const description =
    scope.kind === "global"
      ? t("variable_scope.global_description")
      : t("variable_scope.collection_description");

  const save = async () => {
    // Drop fully-blank rows on save so the file doesn't accumulate noise.
    const cleaned = draft.filter((v) => v.key.trim() !== "" || v.value !== "");
    if (scope.kind === "global") {
      await setGlobalVariables(cleaned);
    } else {
      await setCollectionVariables(scope.collectionId, cleaned);
    }
    onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="flex h-[85vh] max-h-[85vh] w-[92vw] max-w-[1024px] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 py-4 text-left">
          <div className="flex min-w-0 items-start gap-2">
            {scope.kind === "global" ? (
              <Globe size={18} className="mt-0.5 shrink-0 text-primary" />
            ) : (
              <Folder size={18} className="mt-0.5 shrink-0 text-primary" />
            )}
            <div className="min-w-0">
              <DialogTitle className="truncate text-[15px]">{title}</DialogTitle>
              <DialogDescription className="mt-0.5 text-[12px]">
                {description}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <VariablesEditor
            value={draft}
            onChange={setDraft}
            emptyHint={
              scope.kind === "global"
                ? t("variable_scope.empty_global")
                : t("variable_scope.empty_collection")
            }
            previewVars={previewVars}
          />
        </div>

        <DialogFooter className="border-t border-border bg-muted/40 px-5 py-3">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" onClick={save}>
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
