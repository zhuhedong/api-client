import { useTranslation } from "react-i18next";
import { History, FileText } from "lucide-react";
import { useRequestStore } from "../store/useRequestStore";

/** Format an epoch-ms timestamp as a coarse relative-time string. Used by
 *  the Recent Opened list — exact timestamps would clutter the sidebar
 *  and minute-level precision is rarely useful here. */
function formatRelativeTime(
  ts: number,
  t: (k: string, opts?: Record<string, unknown>) => string,
): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return t("time.just_now");
  if (diffSec < 3600) return t("time.minutes_ago", { n: Math.floor(diffSec / 60) });
  if (diffSec < 86400) return t("time.hours_ago", { n: Math.floor(diffSec / 3600) });
  return t("time.days_ago", { n: Math.floor(diffSec / 86400) });
}

/**
 * "Recent Opened" tab content for the sidebar. Renders the recents list
 * with relative timestamps, dispatches `loadFromHistory` /
 * `loadRequestFromCollection` based on the item's storage key prefix, and
 * exposes a "Clear" button.
 *
 * Extracted from `Sidebar.tsx` so the sidebar root component stays focused
 * on layout / tab switching / modal wiring.
 */
export function SidebarRecentTab() {
  const { t } = useTranslation();
  const recentItems = useRequestStore((s) => s.recentItems);
  const loadFromHistory = useRequestStore((s) => s.loadFromHistory);
  const loadRequestFromCollection = useRequestStore(
    (s) => s.loadRequestFromCollection,
  );
  const clearRecent = useRequestStore((s) => s.clearRecent);

  if (recentItems.length === 0) {
    return (
      <div className="space-y-0.5">
        <div className="text-center py-12">
          <History
            size={28}
            className="mx-auto text-text-tertiary mb-2"
            strokeWidth={1.5}
          />
          <p className="text-text-tertiary text-[12px]">
            {t("sidebar.recent_empty")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
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
    </div>
  );
}
