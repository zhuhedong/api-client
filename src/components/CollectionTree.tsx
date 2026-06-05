import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronRight,
  Folder,
  FolderPlus,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import type { Collection, CollectionFolder, CollectionRequest } from "../types";
import { useRequestStore } from "../store/useRequestStore";
import { tagColor } from "../utils/tagColor";
import { ConfirmDialog } from "./ConfirmDialog";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";

/** Method-pill colour table — kept in sync with Sidebar.tsx. */
const METHOD_BADGE: Record<string, string> = {
  GET: "bg-success/15 text-success",
  POST: "bg-orange/15 text-orange",
  PUT: "bg-primary/15 text-primary",
  PATCH: "bg-purple/15 text-purple",
  DELETE: "bg-destructive/15 text-destructive",
  HEAD: "bg-muted-foreground/15 text-muted-foreground",
  OPTIONS: "bg-muted-foreground/15 text-muted-foreground",
};

/** A drag payload identifies a node within *one* collection. We refuse
 *  cross-collection drops so the user has a clear mental model: dragging
 *  is a "rearrange within this collection" gesture, not a move. */
type DragKind = "request" | "folder";
interface DragRef {
  kind: DragKind;
  collectionId: string;
  nodeId: string;
}

function encode(d: DragRef): string {
  return `${d.kind}::${d.collectionId}::${d.nodeId}`;
}

interface RenameTarget {
  kind: "request" | "folder";
  collectionId: string;
  nodeId: string;
}

interface NewFolderTarget {
  collectionId: string;
  parentFolderId: string | null;
}

export interface CollectionTreeViewProps {
  collection: Collection;
  /** The id of the currently-loaded request (if any), used to highlight the
   *  matching tree row. */
  activeRequestId?: string | null;
}

/**
 * Renders the inside of a single collection — its top-level requests and
 * nested folder subtree — with inline rename, delete, drag-drop, and
 * "new folder" affordances. The collection *header* is rendered by the
 * parent (`Sidebar.tsx`) because it carries collection-wide actions
 * (export, runner, auth, variables) that don't apply at folder scope.
 */
export function CollectionTreeView({ collection, activeRequestId }: CollectionTreeViewProps) {
  const { t } = useTranslation();
  const loadRequestFromCollection = useRequestStore((s) => s.loadRequestFromCollection);
  const deleteRequestFromCollection = useRequestStore((s) => s.deleteRequestFromCollection);
  const renameRequestInCollection = useRequestStore((s) => s.renameRequestInCollection);
  const reorderRequestsInCollection = useRequestStore((s) => s.reorderRequestsInCollection);
  const createFolder = useRequestStore((s) => s.createFolder);
  const renameFolderAction = useRequestStore((s) => s.renameFolder);
  const deleteFolder = useRequestStore((s) => s.deleteFolder);
  const moveRequestToFolder = useRequestStore((s) => s.moveRequestToFolder);
  const moveFolderToFolder = useRequestStore((s) => s.moveFolderToFolder);

  const [dragging, setDragging] = useState<DragRef | null>(null);
  // Per-folder collapsed flag; default to expanded.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [renaming, setRenaming] = useState<RenameTarget | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [newFolder, setNewFolder] = useState<NewFolderTarget | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [deletingFolder, setDeletingFolder] = useState<{ id: string; name: string } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<
    | { x: number; y: number; kind: "request"; request: CollectionRequest }
    | { x: number; y: number; kind: "folder"; folder: CollectionFolder }
    | null
  >(null);

  const startRenameRequest = (request: CollectionRequest) => {
    setRenaming({ kind: "request", collectionId: collection.id, nodeId: request.id });
    setRenameValue(request.name);
  };
  const startRenameFolder = (folder: CollectionFolder) => {
    setRenaming({ kind: "folder", collectionId: collection.id, nodeId: folder.id });
    setRenameValue(folder.name);
  };

  const commitRename = async () => {
    const name = renameValue.trim();
    if (!renaming || !name) {
      setRenaming(null);
      setRenameValue("");
      return;
    }
    if (renaming.kind === "request") {
      await renameRequestInCollection(renaming.collectionId, renaming.nodeId, name);
    } else {
      await renameFolderAction(renaming.collectionId, renaming.nodeId, name);
    }
    setRenaming(null);
    setRenameValue("");
  };
  const cancelRename = () => {
    setRenaming(null);
    setRenameValue("");
  };

  const startNewFolder = (parentFolderId: string | null) => {
    setNewFolder({ collectionId: collection.id, parentFolderId });
    setNewFolderName("");
  };
  const commitNewFolder = async () => {
    if (!newFolder) return;
    const name = newFolderName.trim();
    if (!name) {
      setNewFolder(null);
      return;
    }
    await createFolder(newFolder.collectionId, newFolder.parentFolderId, name);
    setNewFolder(null);
    setNewFolderName("");
  };
  const cancelNewFolder = () => {
    setNewFolder(null);
    setNewFolderName("");
  };

  /** Handle a drop on a request row. Reorders within the same parent. */
  const handleDropOnRequest = async (target: CollectionRequest) => {
    if (!dragging) return;
    if (dragging.collectionId !== collection.id) return;
    if (dragging.kind === "request" && dragging.nodeId !== target.id) {
      await reorderRequestsInCollection(collection.id, dragging.nodeId, target.id);
    }
    // Folder → request: no-op (folders only drop onto folders or root).
    setDragging(null);
  };

  /** Handle a drop on a folder row. Requests get moved *into* it;
   *  folders get reordered/moved depending on whether they share a parent. */
  const handleDropOnFolder = async (target: CollectionFolder) => {
    if (!dragging) return;
    if (dragging.collectionId !== collection.id) return;
    if (dragging.kind === "request") {
      await moveRequestToFolder(collection.id, dragging.nodeId, target.id);
    } else if (dragging.nodeId !== target.id) {
      // For now treat folder→folder as "move into target". To reorder
      // siblings the user can drag onto a sibling and use the drop-into
      // gesture — simpler than computing positions, and Postman's UX is
      // similar.
      await moveFolderToFolder(collection.id, dragging.nodeId, target.id);
    }
    setDragging(null);
  };

  /** Drop on the collection-root drop zone moves a node to the top. */
  const handleDropOnRoot = async () => {
    if (!dragging) return;
    if (dragging.collectionId !== collection.id) return;
    if (dragging.kind === "request") {
      await moveRequestToFolder(collection.id, dragging.nodeId, null);
    } else {
      await moveFolderToFolder(collection.id, dragging.nodeId, null);
    }
    setDragging(null);
  };

  const renderRequest = (request: CollectionRequest, depth: number) => {
    const isRenaming =
      renaming?.kind === "request" &&
      renaming.collectionId === collection.id &&
      renaming.nodeId === request.id;
    const isActive = activeRequestId === request.id;
    return (
      <div
        key={request.id}
        draggable={!isRenaming}
        onDragStart={(e) => {
          e.stopPropagation();
          const ref = { kind: "request" as const, collectionId: collection.id, nodeId: request.id };
          setDragging(ref);
          e.dataTransfer.setData("text/plain", encode(ref));
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "move";
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          handleDropOnRequest(request);
        }}
        onDragEnd={() => setDragging(null)}
        className={`group flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg hover:bg-accent cursor-pointer transition-colors ${
          isActive ? "bg-primary/10" : ""
        }`}
        style={{ paddingLeft: `${10 + depth * 14}px` }}
        onClick={() => loadRequestFromCollection(collection.id, request.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setCtxMenu({ x: e.clientX, y: e.clientY, kind: "request", request });
        }}
      >
        <span
          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md shrink-0 ${
            METHOD_BADGE[request.method] || ""
          }`}
        >
          {request.method}
        </span>
        {isRenaming ? (
          <input
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") cancelRename();
            }}
            className="flex-1 bg-card text-foreground px-1.5 py-0.5 rounded text-[12px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            autoFocus
          />
        ) : (
          <span
            className="text-[12px] text-muted-foreground truncate flex-1"
            onDoubleClick={(e) => {
              e.stopPropagation();
              startRenameRequest(request);
            }}
            title={t("common.double_click_to_rename")}
          >
            {request.name || request.url || "Untitled"}
          </span>
        )}
        {request.tags && request.tags.length > 0 && (
          <span className="flex items-center gap-0.5 shrink-0" title={request.tags.join(", ")}>
            {request.tags.slice(0, 3).map((tag) => {
              const c = tagColor(tag);
              return (
                <span
                  key={tag}
                  className={`inline-block w-1.5 h-1.5 rounded-full ${c.bg.replace("/15", "")}`}
                />
              );
            })}
          </span>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            startRenameRequest(request);
          }}
          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-primary/10 rounded-md transition-all"
          title={t("common.rename")}
        >
          <Pencil size={11} className="text-muted-foreground" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            deleteRequestFromCollection(collection.id, request.id);
          }}
          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-destructive/10 rounded-md transition-all"
          title={t("common.delete")}
        >
          <Trash2 size={11} className="text-destructive/70" />
        </button>
      </div>
    );
  };

  const renderFolder = (folder: CollectionFolder, depth: number) => {
    const isRenaming =
      renaming?.kind === "folder" &&
      renaming.collectionId === collection.id &&
      renaming.nodeId === folder.id;
    const isCollapsed = !!collapsed[folder.id];
    const isCreatingHere =
      newFolder &&
      newFolder.collectionId === collection.id &&
      newFolder.parentFolderId === folder.id;
    const totalCount = folder.requests.length + folder.folders.length;
    return (
      <div key={folder.id}>
        <div
          draggable={!isRenaming}
          onDragStart={(e) => {
            e.stopPropagation();
            const ref = { kind: "folder" as const, collectionId: collection.id, nodeId: folder.id };
            setDragging(ref);
            e.dataTransfer.setData("text/plain", encode(ref));
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = "move";
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleDropOnFolder(folder);
          }}
          onDragEnd={() => setDragging(null)}
          className="group flex items-center gap-1.5 px-2.5 py-[7px] rounded-lg hover:bg-accent cursor-pointer transition-colors"
          style={{ paddingLeft: `${10 + depth * 14}px` }}
          onClick={() =>
            setCollapsed((m) => ({ ...m, [folder.id]: !m[folder.id] }))
          }
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setCtxMenu({ x: e.clientX, y: e.clientY, kind: "folder", folder });
          }}
        >
          <ChevronRight
            size={12}
            className={`text-muted-foreground shrink-0 transition-transform ${
              isCollapsed ? "" : "rotate-90"
            }`}
          />
          <Folder size={13} className="text-muted-foreground shrink-0" strokeWidth={1.8} />
          {isRenaming ? (
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") cancelRename();
              }}
              className="flex-1 bg-card text-foreground px-1.5 py-0.5 rounded text-[12px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              autoFocus
            />
          ) : (
            <span
              className="text-[12px] font-medium text-muted-foreground truncate flex-1"
              onDoubleClick={(e) => {
                e.stopPropagation();
                startRenameFolder(folder);
              }}
              title={t("common.double_click_to_rename")}
            >
              {folder.name}
            </span>
          )}
          <span className="text-muted-foreground text-[10px] shrink-0">{totalCount}</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              startNewFolder(folder.id);
              // Make sure the parent is expanded so the inline form is
              // visible after creation.
              setCollapsed((m) => ({ ...m, [folder.id]: false }));
            }}
            className="opacity-0 group-hover:opacity-100 p-1 hover:bg-primary/10 rounded-md transition-all"
            title={t("sidebar.new_folder")}
          >
            <FolderPlus size={11} className="text-muted-foreground" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              startRenameFolder(folder);
            }}
            className="opacity-0 group-hover:opacity-100 p-1 hover:bg-primary/10 rounded-md transition-all"
            title={t("sidebar.rename_folder")}
          >
            <Pencil size={11} className="text-muted-foreground" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setDeletingFolder({ id: folder.id, name: folder.name });
            }}
            className="opacity-0 group-hover:opacity-100 p-1 hover:bg-destructive/10 rounded-md transition-all"
            title={t("common.delete")}
          >
            <Trash2 size={11} className="text-destructive/70" />
          </button>
        </div>
        {!isCollapsed && (
          <div>
            {folder.folders.map((sub) => renderFolder(sub, depth + 1))}
            {folder.requests.map((req) => renderRequest(req, depth + 1))}
            {isCreatingHere && renderNewFolderInput(depth + 1)}
            {totalCount === 0 && !isCreatingHere && (
              <div
                className="text-[11px] text-muted-foreground italic px-2.5 py-1"
                style={{ paddingLeft: `${10 + (depth + 1) * 14}px` }}
              >
                {t("sidebar.empty_folder")}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderNewFolderInput = (depth: number) => (
    <div
      className="flex items-center gap-1.5 px-2.5 py-[6px]"
      style={{ paddingLeft: `${10 + depth * 14}px` }}
    >
      <Folder size={13} className="text-muted-foreground shrink-0" strokeWidth={1.8} />
      <input
        type="text"
        value={newFolderName}
        onChange={(e) => setNewFolderName(e.target.value)}
        onBlur={commitNewFolder}
        onKeyDown={(e) => {
          if (e.key === "Enter") commitNewFolder();
          if (e.key === "Escape") cancelNewFolder();
        }}
        placeholder={t("sidebar.new_folder_placeholder")}
        className="flex-1 bg-card text-foreground px-1.5 py-0.5 rounded text-[12px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        autoFocus
      />
    </div>
  );

  // Collection-root drop zone — accepts drags that should land at the top
  // level of the collection (out of any folder).
  return (
    <div>
      <div
        onDragOver={(e) => {
          if (!dragging || dragging.collectionId !== collection.id) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }}
        onDrop={(e) => {
          e.preventDefault();
          handleDropOnRoot();
        }}
      >
        {collection.folders.map((f) => renderFolder(f, 1))}
        {collection.requests.map((r) => renderRequest(r, 1))}
        {newFolder &&
          newFolder.collectionId === collection.id &&
          newFolder.parentFolderId === null &&
          renderNewFolderInput(1)}
      </div>

      {/* Footer with "New folder at root" action. Lives below the items so it
          doesn't compete with hover targets on the last row. */}
      <div className="flex justify-start mt-0.5">
        <button
          onClick={() => startNewFolder(null)}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary transition-colors px-2.5 py-1"
          title={t("sidebar.new_folder")}
        >
          <Plus size={10} />
          {t("sidebar.new_folder")}
        </button>
      </div>

      <ConfirmDialog
        open={deletingFolder !== null}
        title={t("sidebar.delete_folder_title")}
        message={
          deletingFolder
            ? t("sidebar.delete_folder_message", { name: deletingFolder.name })
            : ""
        }
        onConfirm={() => {
          if (deletingFolder) {
            deleteFolder(collection.id, deletingFolder.id);
          }
          setDeletingFolder(null);
        }}
        onCancel={() => setDeletingFolder(null)}
      />

      {ctxMenu &&
        (() => {
          const menu = ctxMenu;
          const items: ContextMenuItem[] =
            menu.kind === "request"
              ? [
                  {
                    label: t("context_menu.rename"),
                    onSelect: () => startRenameRequest(menu.request),
                  },
                  {
                    label: t("context_menu.delete"),
                    destructive: true,
                    onSelect: () =>
                      deleteRequestFromCollection(collection.id, menu.request.id),
                  },
                ]
              : [
                  {
                    label: t("context_menu.new_folder"),
                    onSelect: () => startNewFolder(menu.folder.id),
                  },
                  {
                    label: t("context_menu.rename"),
                    onSelect: () => startRenameFolder(menu.folder),
                  },
                  {
                    label: t("context_menu.delete"),
                    destructive: true,
                    onSelect: () =>
                      setDeletingFolder({
                        id: menu.folder.id,
                        name: menu.folder.name,
                      }),
                  },
                ];
          return (
            <ContextMenu
              x={menu.x}
              y={menu.y}
              items={items}
              onClose={() => setCtxMenu(null)}
            />
          );
        })()}
    </div>
  );
}
