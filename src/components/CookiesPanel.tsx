import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  X,
  Trash2,
  Cookie,
  Search,
  Eye,
  EyeOff,
  ShieldAlert,
} from "lucide-react";
import { useRequestStore } from "../store/useRequestStore";
import { ConfirmDialog } from "./ConfirmDialog";
import type { CookieEntry } from "../types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/** Fixed-length dot mask for hidden cookie values. Picked to be wide enough
 *  to look "filled" but not so wide it shifts layout. Crucially, this is a
 *  constant — it must not be derived from the real value length, or the dot
 *  count would leak the cookie length back to anyone over-the-shoulder. */
const MASK_LENGTH = 12;

/**
 * Cookies inspector. Mirrors the browser's cookie store UI: grouped by
 * domain, searchable, with per-cookie + per-domain + nuke-all delete
 * actions and a confirmation dialog before any destructive operation.
 *
 * Why the portal: same containing-block bug as `EnvironmentPanel` \u2014 the
 * sidebar's `backdrop-blur-xl` makes itself the containing block for
 * descendant `position: fixed` elements, so without the portal this
 * modal gets clipped to ~256px sidebar width.
 */
export function CookiesPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const cookies = useRequestStore((s) => s.cookies);
  const refreshCookies = useRequestStore((s) => s.refreshCookies);
  const deleteCookie = useRequestStore((s) => s.deleteCookie);
  const clearCookiesByDomain = useRequestStore((s) => s.clearCookiesByDomain);

  const [query, setQuery] = useState("");
  const [showValues, setShowValues] = useState(false);
  // `null` => no confirmation pending. `"all"` => clear-all queued.
  // Otherwise the queued domain string.
  const [pendingClear, setPendingClear] = useState<string | "all" | null>(null);

  useEffect(() => {
    refreshCookies();
  }, [refreshCookies]);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = cookies.filter((c) => {
      if (!q) return true;
      return (
        c.domain.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        c.value.toLowerCase().includes(q)
      );
    });
    const byDomain: Record<string, CookieEntry[]> = {};
    for (const c of filtered) {
      (byDomain[c.domain] ??= []).push(c);
    }
    // Stable sort: domains alphabetically, cookies within each by name.
    return Object.entries(byDomain)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([domain, list]) => [
        domain,
        [...list].sort((a, b) => a.name.localeCompare(b.name)),
      ] as const);
  }, [cookies, query]);

  const visibleCount = useMemo(
    () => grouped.reduce((sum, [, list]) => sum + list.length, 0),
    [grouped],
  );

  const handleConfirmClear = async () => {
    if (!pendingClear) return;
    if (pendingClear === "all") {
      // No backend "clear all" command \u2014 loop the unique domains. We snap
      // the list before iterating because each call refreshes the store.
      const domains = Array.from(new Set(cookies.map((c) => c.domain)));
      for (const d of domains) {
        await clearCookiesByDomain(d);
      }
    } else {
      await clearCookiesByDomain(pendingClear);
    }
    setPendingClear(null);
  };

  return (
    <>
      <Dialog
        open
        onOpenChange={(next) => {
          if (!next) onClose();
        }}
      >
        <DialogContent className="flex h-[80vh] max-h-[80vh] w-[92vw] max-w-[960px] flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="flex-row items-center justify-between space-y-0 border-b border-border px-5 py-4 pr-12 text-left">
            <div className="flex min-w-0 items-center gap-2">
              <Cookie size={18} className="shrink-0 text-primary" />
              <DialogTitle className="text-[15px]">
                {t("cookies.title")}
              </DialogTitle>
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {t("cookies.total_count", { count: cookies.length })}
              </span>
              {query && cookies.length > 0 && (
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  · {t("cookies.matching_count", { count: visibleCount })}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setShowValues((v) => !v)}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted"
                title={
                  showValues
                    ? t("cookies.hide_values_tooltip")
                    : t("cookies.show_values_tooltip")
                }
              >
                {showValues ? <Eye size={11} /> : <EyeOff size={11} />}
                {showValues
                  ? t("cookies.values_shown")
                  : t("cookies.values_hidden")}
              </button>
              <button
                onClick={() => setPendingClear("all")}
                disabled={cookies.length === 0}
                className="rounded-md px-2 py-1 text-[11px] text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-40 disabled:hover:bg-transparent"
              >
                {t("cookies.clear_all")}
              </button>
            </div>
          </DialogHeader>

        <div className="px-5 py-3 border-b border-border shrink-0">
          <div className="relative">
            <Search
              size={13}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
            />
            <Input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("cookies.search_placeholder")}
              className="h-8 w-full pl-8 pr-8 text-[12px]"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-muted"
                title={t("common.clear")}
              >
                <X size={11} className="text-muted-foreground" />
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-auto px-5 py-3 space-y-3">
          {grouped.length === 0 && (
            <div className="text-center py-12 text-[12px] text-muted-foreground">
              {cookies.length === 0
                ? t("cookies.empty")
                : t("cookies.no_matches")}
            </div>
          )}
          {grouped.map(([domain, list]) => (
            <div key={domain} className="bg-muted rounded-lg p-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="text-[12px] font-semibold text-foreground truncate"
                    title={domain}
                  >
                    {domain}
                  </span>
                  <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                    {t("cookies.cookie_count", { count: list.length })}
                  </span>
                </div>
                <button
                  onClick={() => setPendingClear(domain)}
                  className="text-[11px] text-destructive hover:text-destructive/80 transition-colors shrink-0"
                >
                  {t("cookies.clear_domain")}
                </button>
              </div>
              <div className="space-y-1">
                {list.map((c) => (
                  <CookieRow
                    key={c.id}
                    cookie={c}
                    showValue={showValues}
                    onDelete={() => deleteCookie(c.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pendingClear !== null}
        title={
          pendingClear === "all"
            ? t("cookies.confirm_clear_all_title")
            : t("cookies.confirm_clear_domain_title")
        }
        message={
          pendingClear === "all"
            ? t("cookies.confirm_clear_all_message", { count: cookies.length })
            : t("cookies.confirm_clear_domain_message", {
                domain: pendingClear ?? "",
              })
        }
        confirmLabel={t("cookies.clear_action")}
        onConfirm={handleConfirmClear}
        onCancel={() => setPendingClear(null)}
      />
    </>
  );
}

/** Single cookie row. Pulled out so the parent component reads as a list
 *  composition and to keep the per-row toggles / formatting in one place. */
function CookieRow({
  cookie,
  showValue,
  onDelete,
}: {
  cookie: CookieEntry;
  showValue: boolean;
  onDelete: () => void;
}) {
  const { t, i18n } = useTranslation();
  // Per-row override of the panel-wide toggle so the user can peek at a
  // single value without un-hiding everything else. The override only
  // applies when the panel is hiding values — toggling it while the panel
  // is showing everything would be invisible and would re-leak the value
  // on the next "hide all".
  const [override, setOverride] = useState(false);
  // Reset the override whenever the panel-level showValue flips. This stops
  // a stale `override=true` from surviving a "show all → hide all" cycle.
  // Uses the React-recommended "compare previous value during render"
  // pattern (https://react.dev/learn/you-might-not-need-an-effect).
  const [prevShowValue, setPrevShowValue] = useState(showValue);
  if (showValue !== prevShowValue) {
    setPrevShowValue(showValue);
    setOverride(false);
  }
  const visible = showValue || override;

  // Capture `Date.now()` once on mount instead of at every render. Re-running
  // it on each render would (a) trip the react-hooks/purity rule and (b)
  // produce spurious re-renders when nothing about the cookie changed.
  // Cookie-expiry windows are minutes-to-years; a single snapshot is fine.
  const [nowMs] = useState(() => Date.now());
  const expiryLabel = useMemo(
    () => formatExpiry(cookie.expires, nowMs, t, i18n.language),
    [cookie.expires, nowMs, t, i18n.language],
  );
  const expired =
    cookie.expires !== undefined &&
    cookie.expires > 0 &&
    cookie.expires * 1000 < nowMs;

  return (
    <div
      className={`group grid grid-cols-[180px_minmax(0,1fr)_auto] items-start gap-2 px-2 py-1.5 bg-card rounded text-[11px] ${
        expired ? "opacity-60" : ""
      }`}
    >
      <span
        className="font-mono text-foreground truncate"
        title={cookie.name}
      >
        {cookie.name}
      </span>
      <div className="min-w-0">
        <div
          className={`font-mono break-all ${
            visible ? "text-muted-foreground" : "text-muted-foreground tracking-wider"
          }`}
          // When hidden, render a fixed-length dot run (never derived from
          // `cookie.value.length`) so we don't leak length / shape. The
          // `title` is suppressed in the same case to avoid leaking through
          // the native tooltip.
          title={visible ? cookie.value : undefined}
        >
          {visible ? cookie.value : "•".repeat(MASK_LENGTH)}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 flex-wrap text-[10px] text-muted-foreground">
          <span className="font-mono">{cookie.path}</span>
          <span>·</span>
          <span>{expiryLabel}</span>
          {cookie.secure && (
            <span className="text-success">· {t("cookies.flag_secure")}</span>
          )}
          {cookie.http_only && (
            <span className="text-orange">· {t("cookies.flag_http_only")}</span>
          )}
          {expired && (
            <span className="text-destructive flex items-center gap-0.5">
              · <ShieldAlert size={10} /> {t("cookies.flag_expired")}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
        <button
          onClick={() => setOverride((v) => !v)}
          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-muted rounded transition-all"
          title={
            visible
              ? t("cookies.hide_value_tooltip")
              : t("cookies.show_value_tooltip")
          }
        >
          {visible ? (
            <Eye size={11} className="text-muted-foreground" />
          ) : (
            <EyeOff size={11} className="text-muted-foreground" />
          )}
        </button>
        <button
          onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-destructive/10 rounded transition-all"
          title={t("cookies.delete_cookie_tooltip")}
        >
          <Trash2 size={11} className="text-destructive/70" />
        </button>
      </div>
    </div>
  );
}

/**
 * Human-readable cookie expiry. Three buckets:
 *   - Session cookie (no `expires`)
 *   - Expired (timestamp in the past)
 *   - Future (formatted as locale-aware date + time)
 *
 * Cookie expiry from SQLite is stored as unix *seconds* (matches the spec
 * and `reqwest`'s parsing), so we multiply by 1000 to compare against the
 * `nowMs` snapshot captured by the caller.
 */
function formatExpiry(
  expires: number | undefined,
  nowMs: number,
  t: ReturnType<typeof useTranslation>["t"],
  locale: string,
): string {
  if (expires === undefined || expires <= 0) return t("cookies.session");
  const date = new Date(expires * 1000);
  // Detect malformed timestamps so we don't render "Invalid Date".
  if (Number.isNaN(date.getTime())) return t("cookies.expiry_unknown");
  if (date.getTime() < nowMs) {
    return t("cookies.expired_at", { date: date.toLocaleDateString(locale) });
  }
  return t("cookies.expires_on", {
    date: date.toLocaleDateString(locale),
    time: date.toLocaleTimeString(locale, {
      hour: "2-digit",
      minute: "2-digit",
    }),
  });
}
