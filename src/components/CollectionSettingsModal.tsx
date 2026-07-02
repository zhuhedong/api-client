import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useRequestStore } from "../store/useRequestStore";
import { AuthEditor } from "./AuthEditor";
import { VariablesEditor } from "./VariablesEditor";
import { CodeEditor } from "./CodeEditor";
import type { AuthConfig, EnvVariable } from "../types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

export type CollectionSettingsTab =
  | "description"
  | "auth"
  | "variables"
  | "scripts";

interface Props {
  /** Collection to edit. `null` keeps the modal closed. */
  collectionId: string | null;
  initialTab?: CollectionSettingsTab;
  onClose: () => void;
}

/**
 * Unified collection editor: description, root auth, collection variables, and
 * collection-level pre/post scripts. Everything is drafted locally and written
 * in one `updateCollection` call (which routes through `save_collection`'s
 * keychain-sanitize path, so auth secrets never hit disk).
 */
export function CollectionSettingsModal({
  collectionId,
  initialTab = "description",
  onClose,
}: Props) {
  const { t } = useTranslation();
  const collections = useRequestStore((s) => s.collections);
  const updateCollection = useRequestStore((s) => s.updateCollection);
  const collection = collections.find((c) => c.id === collectionId) || null;

  const [tab, setTab] = useState<CollectionSettingsTab>(initialTab);
  const [description, setDescription] = useState(collection?.description ?? "");
  const [auth, setAuth] = useState<AuthConfig>(
    collection?.auth || { auth_type: "none" },
  );
  const [variables, setVariables] = useState<EnvVariable[]>(
    collection?.variables ?? [],
  );
  const [preScript, setPreScript] = useState(collection?.pre_script ?? "");
  const [postScript, setPostScript] = useState(collection?.post_script ?? "");

  // Reset drafts when the modal opens against a different collection. Uses the
  // React-recommended "compare previous value during render" pattern.
  const [prevId, setPrevId] = useState(collection?.id);
  if (collection?.id !== prevId) {
    setPrevId(collection?.id);
    setDescription(collection?.description ?? "");
    setAuth(collection?.auth || { auth_type: "none" });
    setVariables(collection?.variables ?? []);
    setPreScript(collection?.pre_script ?? "");
    setPostScript(collection?.post_script ?? "");
    setTab(initialTab);
  }

  if (!collectionId || !collection) return null;

  const save = async () => {
    await updateCollection({
      ...collection,
      description,
      auth: auth.auth_type === "none" ? undefined : auth,
      variables,
      pre_script: preScript.trim() ? preScript : undefined,
      post_script: postScript.trim() ? postScript : undefined,
    });
    onClose();
  };

  const TABS: { id: CollectionSettingsTab; label: string }[] = [
    { id: "description", label: t("collection_settings.tab_description") },
    { id: "auth", label: t("collection_settings.tab_auth") },
    { id: "variables", label: t("collection_settings.tab_variables") },
    { id: "scripts", label: t("collection_settings.tab_scripts") },
  ];

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="flex max-h-[85vh] w-[92vw] max-w-[640px] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-4 py-3 text-left">
          <DialogTitle className="text-[13px]">
            {t("collection_settings.title", { name: collection.name })}
          </DialogTitle>
        </DialogHeader>
        <div className="px-4 pt-3">
          <Tabs value={tab} onValueChange={(v) => setTab(v as CollectionSettingsTab)}>
            <TabsList className="h-auto flex-wrap justify-start">
              {TABS.map((tb) => (
                <TabsTrigger key={tb.id} value={tb.id}>
                  {tb.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {tab === "description" && (
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("collection_settings.description_placeholder")}
              spellCheck={false}
              className="min-h-[320px] w-full resize-y text-[13px]"
            />
          )}
          {tab === "auth" && <AuthEditor value={auth} onChange={setAuth} />}
          {tab === "variables" && (
            <VariablesEditor
              value={variables}
              onChange={setVariables}
              emptyHint={t("collection_settings.variables_empty")}
            />
          )}
          {tab === "scripts" && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {t("collection_settings.pre_script")}
                </label>
                <p className="text-[11px] text-muted-foreground">
                  {t("collection_settings.pre_script_hint")}
                </p>
                <CodeEditor
                  value={preScript}
                  onChange={setPreScript}
                  language="javascript"
                  height={150}
                  placeholder={"pm.environment.set('token', '...')"}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {t("collection_settings.post_script")}
                </label>
                <p className="text-[11px] text-muted-foreground">
                  {t("collection_settings.post_script_hint")}
                </p>
                <CodeEditor
                  value={postScript}
                  onChange={setPostScript}
                  language="javascript"
                  height={150}
                  placeholder={"pm.test('status is 200', () => {\n  pm.expect(pm.response.status).to.equal(200);\n});"}
                />
              </div>
            </div>
          )}
        </div>
        <DialogFooter className="border-t border-border px-4 py-3">
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
