import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Search, X, Clock, Trash2 } from "lucide-react";
import { useRequestStore } from "../store/useRequestStore";

interface SidebarHistoryTabProps {
  /**
   * Lifted to the parent `Sidebar` (which never unmounts when the user
   * switches tabs) so the filter survives History/Collections/Recent
   * tab switches. If we stored it locally, switching away and back
   * would clear the search box but leave the store's `history` array
   * filtered — the user would see an empty input over a filtered list.
   */
  searchQuery: string;
  setSearchQuery: (q: string) => void;
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

/**
 * "History" tab content for the sidebar. Renders the search box, the
 * history list with method badges + drag-to-reorder, and the "Clear All"
 * button. Extracted from `Sidebar.tsx` so the parent stays focused on
 * layout + tab switching.
 *
 * Search state lives on the parent `Sidebar` (see prop docs above) so
 * the filter persists across tab switches. When the box is cleared we
 * explicitly call `initialize()` to refetch the full history listing
 * (mirrors the previous inline implementation).
 */
export function SidebarHistoryTab({
  searchQuery,
  setSearchQuery,
}: SidebarHistoryTabProps) {
  const { t } = useTranslation();
  const history = useRequestStore((s) => s.history);
  const activeRequestId = useRequestStore((s) => s.activeRequestId);
  const loadFromHistory = useRequestStore((s) => s.loadFromHistory);
  const deleteRequestFromHistory = useRequestStore(
    (s) => s.deleteRequestFromHistory,
  );
  const clearAllHistory = useRequestStore((s) => s.clearAllHistory);
  const searchHistory = useRequestStore((s) => s.searchHistory);
  const reorderHistory = useRequestStore((s) => s.reorderHistory);

  const [draggingId, setDraggingId] = useState<string | null>(null);

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    if (query.trim()) {
      searchHistory(query.trim());
    } else {
      useRequestStore.getState().initialize();
    }
  };

  return (
    <div>
      {/* Search bar */}
      <div className="px-0.5 pb-2">
        <div className="relative">
          <Search
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary"
          />
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
            <Clock
              size={28}
              className="mx-auto text-text-tertiary mb-2"
              strokeWidth={1.5}
            />
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
                try {
                  return new URL(item.url).pathname;
                } catch {
                  return item.url || "Untitled";
                }
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
  );
}
