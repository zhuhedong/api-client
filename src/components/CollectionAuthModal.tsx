import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useRequestStore } from "../store/useRequestStore";
import { AuthEditor } from "./AuthEditor";
import type { AuthConfig } from "../types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface Props {
  /** Collection to edit. `null` closes the modal. */
  collectionId: string | null;
  onClose: () => void;
}

/**
 * Edit a collection's root-level auth. Saving writes back through
 * `setCollectionAuth`, which goes through the usual `save_collection`
 * sanitize path so any bearer tokens / passwords end up in the keychain
 * rather than on disk.
 */
export function CollectionAuthModal({ collectionId, onClose }: Props) {
  const { t } = useTranslation();
  const collections = useRequestStore((s) => s.collections);
  const setCollectionAuth = useRequestStore((s) => s.setCollectionAuth);
  const collection = collections.find((c) => c.id === collectionId) || null;

  const [draft, setDraft] = useState<AuthConfig>(
    () => collection?.auth || { auth_type: "none" },
  );

  // Reset the draft when the editor opens against a different collection.
  // Uses the React-recommended "compare previous value during render" pattern
  // to avoid a useEffect that would only mirror the new collection's state.
  const [prevCollectionId, setPrevCollectionId] = useState(collection?.id);
  if (collection?.id !== prevCollectionId) {
    setPrevCollectionId(collection?.id);
    setDraft(collection?.auth || { auth_type: "none" });
  }

  if (!collectionId || !collection) return null;

  const save = async () => {
    // Strip an explicit "no auth" config back to undefined so the collection
    // file doesn't gain an irrelevant auth block.
    await setCollectionAuth(
      collection.id,
      draft.auth_type === "none" ? undefined : draft,
    );
    onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="flex max-h-[85vh] max-w-[560px] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-4 py-3 text-left">
          <DialogTitle className="text-[13px]">
            {t("collection_auth.title")}
          </DialogTitle>
          <DialogDescription className="text-[11px]">
            {t("collection_auth.subtitle_prefix")}{" "}
            <span className="font-medium text-foreground">
              {collection.name}
            </span>{" "}
            {t("collection_auth.subtitle_suffix")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-auto p-4">
          <AuthEditor value={draft} onChange={setDraft} />
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
