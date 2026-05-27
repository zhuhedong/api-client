import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { X, ChevronRight, ChevronDown, Folder, FolderOpen, Layers } from "lucide-react";
import { useRequestStore } from "../store/useRequestStore";
import type { Collection, CollectionFolder } from "../types";
import {
  initialSelectedDestination,
  type SaveDestination,
} from "../utils/saveToCollection";

interface Props {
  /** Closes the modal. */
  onClose: () => void;
  /** Called after a successful save. */
  onSaved?: () => void;
  /**
   * Pre-populate the error banner. Used by the ⌘S keyboard shortcut so
   * that when an in-place save fails, we open this modal *with* the
   * backend error already visible — instead of failing silently and
   * leaving the user thinking the save succeeded.
   */
  initialError?: string | null;
}

/** Alias kept for the component's local readability. */
type Destination = SaveDestination;

function destinationEquals(a: Destination | null, b: Destination): boolean {
  if (!a) return false;
  if (a.kind !== b.kind || a.collectionId !== b.collectionId) return false;
  if (a.kind === "folder" && b.kind === "folder") return a.folderId === b.folderId;
  return true;
}

/**
 * Modal that lets the user save the active tab into a destination inside
 * one of their collections. Triggered by ⌘S / Ctrl+S when the active tab
 * isn't already bound to a collection.
 *
 * The destination tree is collection → nested folders. Top-level (no
 * folder) is selectable via the collection row itself. The dialog also
 * shows a name field so the user can rename before saving.
 */
export function SaveToCollectionModal({ onClose, onSaved, initialError }: Props) {
  const { t } = useTranslation();
  const collections = useRequestStore((s) => s.collections);
  const activeRequest = useRequestStore((s) => s.activeRequest);
  const saveActiveRequest = useRequestStore((s) => s.saveActiveRequest);
  const updateActiveRequest = useRequestStore((s) => s.updateActiveRequest);

  // Auto-expand the collection that the active tab currently belongs to
  // (if any) so the user lands close to where they last saved. Skip when
  // the tab points at a collection that has since been deleted — there's
  // nothing useful to expand.
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    const cid = activeRequest?.collectionId;
    if (cid && collections.some((c) => c.id === cid)) initial.add(cid);
    return initial;
  });
  // Pre-select the active tab's current collection — but only if it still
  // exists. See `initialSelectedDestination` for the rationale.
  const [selected, setSelected] = useState<Destination | null>(() =>
    initialSelectedDestination(activeRequest?.collectionId, collections),
  );
  const [name, setName] = useState(activeRequest?.name || "Untitled Request");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);

  const toggleCollection = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleFolder = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Defence in depth: even after the modal is open, the collections list
  // is reactive — if a collection is deleted while we're sitting on the
  // dialog, the Save button should disable itself rather than dispatch a
  // save that the backend will immediately reject.
  const selectedCollectionExists = useMemo(
    () => (selected ? collections.some((c) => c.id === selected.collectionId) : false),
    [selected, collections],
  );
  const canSave = useMemo(
    () => selected !== null && selectedCollectionExists && name.trim().length > 0 && !saving,
    [selected, selectedCollectionExists, name, saving],
  );

  const onSubmit = async () => {
    if (!selected || !activeRequest) return;
    setSaving(true);
    setError(null);
    const trimmed = name.trim();
    if (trimmed && trimmed !== activeRequest.name) {
      updateActiveRequest({ name: trimmed });
    }
    try {
      const target =
        selected.kind === "folder"
          ? { collectionId: selected.collectionId, folderId: selected.folderId }
          : { collectionId: selected.collectionId, folderId: null };
      const ok = await saveActiveRequest(target);
      if (!ok) {
        setError(t("save_collection.error_no_target"));
        setSaving(false);
        return;
      }
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-surface rounded-apple-lg shadow-apple-lg w-[520px] max-w-[92vw] max-h-[85vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-light">
          <div className="flex items-center gap-2">
            <Layers size={18} className="text-accent" />
            <h2 className="text-[15px] font-semibold text-text-primary">
              {t("save_collection.title")}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-surface-secondary transition-colors"
          >
            <X size={16} className="text-text-tertiary" />
          </button>
        </div>

        <div className="px-5 pt-4 pb-2">
          <label className="text-[12px] font-medium text-text-secondary block mb-1.5">
            {t("save_collection.name")}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input-apple w-full text-[12px]"
            placeholder={t("save_collection.name_placeholder")}
          />
        </div>

        <div className="px-5 pb-2">
          <div className="text-[12px] font-medium text-text-secondary mb-1.5">
            {t("save_collection.destination")}
          </div>
          <div className="border border-border-light rounded-md max-h-[280px] overflow-y-auto">
            {collections.length === 0 ? (
              <div className="px-3 py-6 text-center text-[12px] text-text-tertiary">
                {t("save_collection.no_collections")}
              </div>
            ) : (
              collections.map((col) => (
                <CollectionRow
                  key={col.id}
                  collection={col}
                  expanded={expanded}
                  selected={selected}
                  onToggle={toggleCollection}
                  onToggleFolder={toggleFolder}
                  onSelect={setSelected}
                />
              ))
            )}
          </div>
        </div>

        {error && (
          <div className="px-5 pb-2 text-[11px] text-error">{error}</div>
        )}

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border-light">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-[12px] rounded-apple hover:bg-surface-secondary transition-colors"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={onSubmit}
            disabled={!canSave}
            className="px-3 py-1.5 bg-accent text-white text-[12px] rounded-apple hover:bg-accent-hover active:scale-[0.97] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

interface CollectionRowProps {
  collection: Collection;
  expanded: Set<string>;
  selected: Destination | null;
  onToggle: (id: string) => void;
  onToggleFolder: (id: string) => void;
  onSelect: (dest: Destination) => void;
}

function CollectionRow({
  collection,
  expanded,
  selected,
  onToggle,
  onToggleFolder,
  onSelect,
}: CollectionRowProps) {
  const isOpen = expanded.has(collection.id);
  const isSelected = destinationEquals(selected, {
    kind: "collection",
    collectionId: collection.id,
  });

  return (
    <div className="text-[12px]">
      <div
        className={`flex items-center gap-1 px-2 py-1.5 cursor-pointer ${
          isSelected ? "bg-accent/10 text-accent" : "hover:bg-surface-secondary"
        }`}
        onClick={() =>
          onSelect({ kind: "collection", collectionId: collection.id })
        }
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle(collection.id);
          }}
          className="w-4 h-4 flex items-center justify-center text-text-tertiary"
        >
          {collection.folders.length > 0 ? (
            isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />
          ) : null}
        </button>
        <Layers size={12} className="text-text-tertiary shrink-0" />
        <span className="truncate">{collection.name}</span>
      </div>
      {isOpen && collection.folders.length > 0 && (
        <div className="pl-3">
          {collection.folders.map((folder) => (
            <FolderRow
              key={folder.id}
              folder={folder}
              collectionId={collection.id}
              depth={1}
              expanded={expanded}
              selected={selected}
              onToggleFolder={onToggleFolder}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface FolderRowProps {
  folder: CollectionFolder;
  collectionId: string;
  depth: number;
  expanded: Set<string>;
  selected: Destination | null;
  onToggleFolder: (id: string) => void;
  onSelect: (dest: Destination) => void;
}

function FolderRow({
  folder,
  collectionId,
  depth,
  expanded,
  selected,
  onToggleFolder,
  onSelect,
}: FolderRowProps) {
  const isOpen = expanded.has(folder.id);
  const isSelected = destinationEquals(selected, {
    kind: "folder",
    collectionId,
    folderId: folder.id,
  });
  return (
    <div>
      <div
        className={`flex items-center gap-1 px-2 py-1.5 cursor-pointer ${
          isSelected ? "bg-accent/10 text-accent" : "hover:bg-surface-secondary"
        }`}
        style={{ paddingLeft: 8 + depth * 12 }}
        onClick={() =>
          onSelect({ kind: "folder", collectionId, folderId: folder.id })
        }
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleFolder(folder.id);
          }}
          className="w-4 h-4 flex items-center justify-center text-text-tertiary"
        >
          {folder.folders.length > 0 ? (
            isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />
          ) : null}
        </button>
        {isOpen ? (
          <FolderOpen size={12} className="text-text-tertiary shrink-0" />
        ) : (
          <Folder size={12} className="text-text-tertiary shrink-0" />
        )}
        <span className="truncate">{folder.name}</span>
      </div>
      {isOpen && folder.folders.length > 0 && (
        <div>
          {folder.folders.map((f) => (
            <FolderRow
              key={f.id}
              folder={f}
              collectionId={collectionId}
              depth={depth + 1}
              expanded={expanded}
              selected={selected}
              onToggleFolder={onToggleFolder}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}
