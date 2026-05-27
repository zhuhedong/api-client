import { useState } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Settings as SettingsIcon,
  ShieldCheck,
  ShieldAlert,
  Trash2,
  Sun,
  Moon,
  Monitor,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useRequestStore } from "../store/useRequestStore";
import { setLocale, SUPPORTED_LOCALES, type Locale } from "../i18n";
import {
  getThemeMode,
  setThemeMode,
  type ThemeMode,
} from "../utils/theme";
import { ConfirmDialog } from "./ConfirmDialog";

/** Bytes-per-MiB shortcut. The UI shows MiB to keep numbers readable
 *  (10 MiB ≫ 10485760) and converts to/from bytes when persisting. */
const MIB = 1024 * 1024;

type ClearTarget = "history" | "recent" | "cookies" | null;

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const defaultTimeoutMs = useRequestStore((s) => s.defaultTimeoutMs);
  const setDefaultTimeoutMs = useRequestStore((s) => s.setDefaultTimeoutMs);
  const verifyTlsDefault = useRequestStore((s) => s.verifyTlsDefault);
  const setVerifyTlsDefault = useRequestStore((s) => s.setVerifyTlsDefault);
  const maxBodyBytes = useRequestStore((s) => s.maxBodyBytes);
  const setMaxBodyBytes = useRequestStore((s) => s.setMaxBodyBytes);
  const maxHistoryBodyBytes = useRequestStore((s) => s.maxHistoryBodyBytes);
  const setMaxHistoryBodyBytes = useRequestStore((s) => s.setMaxHistoryBodyBytes);
  const defaultRedirectPolicy = useRequestStore((s) => s.defaultRedirectPolicy);
  const setDefaultRedirectPolicy = useRequestStore((s) => s.setDefaultRedirectPolicy);
  const defaultMaxRedirects = useRequestStore((s) => s.defaultMaxRedirects);
  const setDefaultMaxRedirects = useRequestStore((s) => s.setDefaultMaxRedirects);
  const defaultProxyUrl = useRequestStore((s) => s.defaultProxyUrl);
  const setDefaultProxyUrl = useRequestStore((s) => s.setDefaultProxyUrl);
  const clearAllHistory = useRequestStore((s) => s.clearAllHistory);
  const clearAllRecent = useRequestStore((s) => s.clearAllRecent);
  const clearAllCookies = useRequestStore((s) => s.clearAllCookies);

  const [value, setValue] = useState(String(defaultTimeoutMs));
  const [maxBodyMiB, setMaxBodyMiB] = useState(String(Math.max(1, Math.round(maxBodyBytes / MIB))));
  const [maxHistoryBodyKiB, setMaxHistoryBodyKiB] = useState(
    String(Math.max(1, Math.round(maxHistoryBodyBytes / 1024)))
  );
  const [proxyDraft, setProxyDraft] = useState(defaultProxyUrl);
  const [maxRedirectsDraft, setMaxRedirectsDraft] = useState(String(defaultMaxRedirects));
  const [saved, setSaved] = useState(false);
  const [savedMaxBody, setSavedMaxBody] = useState(false);
  const [savedHistBody, setSavedHistBody] = useState(false);
  const [savedProxy, setSavedProxy] = useState(false);
  const [savedRedirects, setSavedRedirects] = useState(false);
  // Theme mode is stored in localStorage rather than the request store
  // (it pre-renders before React mounts to avoid a flash of the wrong
  // theme). We mirror it into local state so the dropdown stays in sync.
  const [themeMode, setLocalThemeMode] = useState<ThemeMode>(() => getThemeMode());
  const [clearTarget, setClearTarget] = useState<ClearTarget>(null);
  const [cleared, setCleared] = useState<ClearTarget>(null);

  // Drive the dropdown straight off i18next so it stays in sync when the
  // user changes language elsewhere in the future.
  const currentLocale = (i18n.language?.split("-")[0] ?? "en") as Locale;

  const save = async () => {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n) || n <= 0) return;
    await setDefaultTimeoutMs(n);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const saveMaxBody = async () => {
    const n = parseInt(maxBodyMiB, 10);
    if (!Number.isFinite(n) || n <= 0 || n > 1024) return;
    await setMaxBodyBytes(n * MIB);
    setSavedMaxBody(true);
    setTimeout(() => setSavedMaxBody(false), 1500);
  };

  const saveHistBody = async () => {
    const n = parseInt(maxHistoryBodyKiB, 10);
    if (!Number.isFinite(n) || n < 0 || n > 10240) return;
    await setMaxHistoryBodyBytes(n * 1024);
    setSavedHistBody(true);
    setTimeout(() => setSavedHistBody(false), 1500);
  };

  const saveProxy = async () => {
    await setDefaultProxyUrl(proxyDraft);
    setSavedProxy(true);
    setTimeout(() => setSavedProxy(false), 1500);
  };

  const saveMaxRedirects = async () => {
    const n = parseInt(maxRedirectsDraft, 10);
    if (!Number.isFinite(n) || n < 0 || n > 100) return;
    await setDefaultMaxRedirects(n);
    setSavedRedirects(true);
    setTimeout(() => setSavedRedirects(false), 1500);
  };

  const handleThemeChange = (mode: ThemeMode) => {
    setLocalThemeMode(mode);
    setThemeMode(mode);
  };

  const confirmClear = async () => {
    if (!clearTarget) return;
    if (clearTarget === "history") await clearAllHistory();
    else if (clearTarget === "recent") await clearAllRecent();
    else if (clearTarget === "cookies") await clearAllCookies();
    const target = clearTarget;
    setClearTarget(null);
    setCleared(target);
    setTimeout(() => setCleared(null), 1500);
  };

  const clearLabels: Record<Exclude<ClearTarget, null>, { title: string; message: string }> = {
    history: {
      title: t("settings.clear_history_confirm_title"),
      message: t("settings.clear_history_confirm_message"),
    },
    recent: {
      title: t("settings.clear_recent_confirm_title"),
      message: t("settings.clear_recent_confirm_message"),
    },
    cookies: {
      title: t("settings.clear_cookies_confirm_title"),
      message: t("settings.clear_cookies_confirm_message"),
    },
  };

  // Portal to <body> so we escape the sidebar's `backdrop-blur-xl`
  // containing block (without it, the modal is clipped to the sidebar).
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-surface rounded-apple-lg shadow-apple-lg w-[520px] max-w-[92vw] max-h-[85vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-light">
          <div className="flex items-center gap-2">
            <SettingsIcon size={18} className="text-accent" />
            <h2 className="text-[15px] font-semibold text-text-primary">{t("settings.settings")}</h2>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-surface-secondary transition-colors"
          >
            <X size={16} className="text-text-tertiary" />
          </button>
        </div>

        <div className="p-5 space-y-5 overflow-y-auto">
          {/* Appearance */}
          <section className="space-y-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
              {t("settings.appearance")}
            </h3>

            <div>
              <label className="text-[12px] font-medium text-text-secondary block mb-1.5">
                {t("settings.language")}
              </label>
              <select
                value={currentLocale}
                onChange={(e) => setLocale(e.target.value as Locale)}
                className="input-apple w-full text-[12px]"
              >
                {SUPPORTED_LOCALES.map((loc) => (
                  <option key={loc} value={loc}>
                    {loc === "en"
                      ? t("settings.language_english")
                      : t("settings.language_chinese")}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[12px] font-medium text-text-secondary block mb-1.5">
                {t("settings.theme")}
              </label>
              <div className="flex items-center gap-1.5">
                {([
                  ["light", t("settings.theme_light"), <Sun key="s" size={13} />],
                  ["dark", t("settings.theme_dark"), <Moon key="m" size={13} />],
                  ["system", t("settings.theme_system"), <Monitor key="d" size={13} />],
                ] as const).map(([mode, label, icon]) => {
                  const active = themeMode === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => handleThemeChange(mode)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] rounded-apple border transition-colors ${
                        active
                          ? "bg-accent/10 border-accent text-accent"
                          : "bg-surface border-border-light hover:bg-surface-secondary text-text-secondary"
                      }`}
                      aria-pressed={active}
                    >
                      {icon}
                      {label}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-text-tertiary mt-1.5">
                {t("settings.theme_hint")}
              </p>
            </div>
          </section>

          {/* Behavior */}
          <section className="space-y-3 pt-1">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
              {t("settings.behavior")}
            </h3>

            <div>
              <label className="text-[12px] font-medium text-text-secondary block mb-1.5">
                {t("settings.default_timeout")}
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  min={1}
                  className="input-apple flex-1 text-[12px]"
                />
                <button
                  onClick={save}
                  className="px-3 py-1.5 bg-accent text-white text-[12px] rounded-apple hover:bg-accent-hover active:scale-[0.97] transition-all"
                >
                  {saved ? t("common.saved") : t("common.save")}
                </button>
              </div>
            </div>

            <div>
              <label className="text-[12px] font-medium text-text-secondary block mb-1.5">
                {t("settings.default_redirect_policy")}
              </label>
              <select
                value={defaultRedirectPolicy}
                onChange={(e) =>
                  setDefaultRedirectPolicy(
                    e.target.value as "follow" | "none" | "manual",
                  )
                }
                className="input-apple w-full text-[12px]"
              >
                <option value="follow">{t("settings.redirect_follow")}</option>
                <option value="manual">{t("settings.redirect_manual")}</option>
                <option value="none">{t("settings.redirect_none")}</option>
              </select>
              <p className="text-[11px] text-text-tertiary mt-1.5">
                {t("settings.default_redirect_hint")}
              </p>
            </div>

            <div>
              <label className="text-[12px] font-medium text-text-secondary block mb-1.5">
                {t("settings.default_max_redirects")}
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={maxRedirectsDraft}
                  onChange={(e) => setMaxRedirectsDraft(e.target.value)}
                  min={0}
                  max={100}
                  disabled={defaultRedirectPolicy !== "follow"}
                  className="input-apple flex-1 text-[12px] disabled:opacity-50"
                />
                <button
                  onClick={saveMaxRedirects}
                  disabled={defaultRedirectPolicy !== "follow"}
                  className="px-3 py-1.5 bg-accent text-white text-[12px] rounded-apple hover:bg-accent-hover active:scale-[0.97] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {savedRedirects ? t("common.saved") : t("common.save")}
                </button>
              </div>
            </div>

            <div>
              <label className="text-[12px] font-medium text-text-secondary block mb-1.5">
                {t("settings.default_proxy_url")}
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={proxyDraft}
                  onChange={(e) => setProxyDraft(e.target.value)}
                  placeholder={t("settings.default_proxy_url_placeholder")}
                  className="input-apple flex-1 text-[12px] font-mono"
                  spellCheck={false}
                />
                <button
                  onClick={saveProxy}
                  className="px-3 py-1.5 bg-accent text-white text-[12px] rounded-apple hover:bg-accent-hover active:scale-[0.97] transition-all"
                >
                  {savedProxy ? t("common.saved") : t("common.save")}
                </button>
              </div>
              <p className="text-[11px] text-text-tertiary mt-1.5">
                {t("settings.default_proxy_url_hint")}
              </p>
            </div>

            <div>
              <label className="text-[12px] font-medium text-text-secondary block mb-1.5">
                {t("settings.max_body_bytes")}
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={maxBodyMiB}
                  onChange={(e) => setMaxBodyMiB(e.target.value)}
                  min={1}
                  max={1024}
                  className="input-apple flex-1 text-[12px]"
                />
                <span className="text-[11px] text-text-tertiary shrink-0 w-8">MiB</span>
                <button
                  onClick={saveMaxBody}
                  className="px-3 py-1.5 bg-accent text-white text-[12px] rounded-apple hover:bg-accent-hover active:scale-[0.97] transition-all"
                >
                  {savedMaxBody ? t("common.saved") : t("common.save")}
                </button>
              </div>
              <p className="text-[11px] text-text-tertiary mt-1.5">
                {t("settings.max_body_bytes_hint")}
              </p>
            </div>

            <div>
              <label className="text-[12px] font-medium text-text-secondary block mb-1.5">
                {t("settings.max_history_body_bytes")}
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={maxHistoryBodyKiB}
                  onChange={(e) => setMaxHistoryBodyKiB(e.target.value)}
                  min={0}
                  max={10240}
                  className="input-apple flex-1 text-[12px]"
                />
                <span className="text-[11px] text-text-tertiary shrink-0 w-8">KiB</span>
                <button
                  onClick={saveHistBody}
                  className="px-3 py-1.5 bg-accent text-white text-[12px] rounded-apple hover:bg-accent-hover active:scale-[0.97] transition-all"
                >
                  {savedHistBody ? t("common.saved") : t("common.save")}
                </button>
              </div>
              <p className="text-[11px] text-text-tertiary mt-1.5">
                {t("settings.max_history_body_bytes_hint")}
              </p>
            </div>

            <div>
              <label className="text-[12px] font-medium text-text-secondary block mb-1.5">
                {t("settings.verify_tls_default")}
              </label>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setVerifyTlsDefault(!verifyTlsDefault)}
                  className={`relative inline-flex h-[22px] w-[38px] shrink-0 cursor-pointer rounded-full border transition-colors ${
                    verifyTlsDefault
                      ? "bg-accent border-accent"
                      : "bg-surface-secondary border-border"
                  }`}
                  role="switch"
                  aria-checked={verifyTlsDefault}
                >
                  <span
                    className={`inline-block h-[18px] w-[18px] transform rounded-full bg-white shadow-sm transition-transform ${
                      verifyTlsDefault ? "translate-x-[18px]" : "translate-x-[2px]"
                    } translate-y-[1px]`}
                  />
                </button>
                <div className="flex items-center gap-1.5 text-[12px]">
                  {verifyTlsDefault ? (
                    <>
                      <ShieldCheck size={14} className="text-success" />
                      <span className="text-text-primary">{t("settings.tls_on")}</span>
                    </>
                  ) : (
                    <>
                      <ShieldAlert size={14} className="text-warning" />
                      <span className="text-warning">{t("settings.tls_off")}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* Data management */}
          <section className="space-y-2 pt-1">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
              {t("settings.data")}
            </h3>
            <p className="text-[11px] text-text-tertiary">
              {t("settings.data_hint")}
            </p>
            <div className="flex flex-col gap-1.5">
              <ClearRow
                label={t("settings.clear_history")}
                description={t("settings.clear_history_hint")}
                clearedFlag={cleared === "history"}
                onClick={() => setClearTarget("history")}
                t={t}
              />
              <ClearRow
                label={t("settings.clear_recent")}
                description={t("settings.clear_recent_hint")}
                clearedFlag={cleared === "recent"}
                onClick={() => setClearTarget("recent")}
                t={t}
              />
              <ClearRow
                label={t("settings.clear_cookies")}
                description={t("settings.clear_cookies_hint")}
                clearedFlag={cleared === "cookies"}
                onClick={() => setClearTarget("cookies")}
                t={t}
              />
            </div>
          </section>
        </div>
      </div>

      <ConfirmDialog
        open={clearTarget !== null}
        title={clearTarget ? clearLabels[clearTarget].title : ""}
        message={clearTarget ? clearLabels[clearTarget].message : ""}
        confirmLabel={t("settings.clear_confirm")}
        cancelLabel={t("common.cancel")}
        variant="danger"
        onConfirm={confirmClear}
        onCancel={() => setClearTarget(null)}
      />
    </div>,
    document.body,
  );
}

interface ClearRowProps {
  label: string;
  description: string;
  clearedFlag: boolean;
  onClick: () => void;
  t: (k: string) => string;
}

function ClearRow({ label, description, clearedFlag, onClick, t }: ClearRowProps) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="flex-1 min-w-0">
        <div className="text-[12px] text-text-primary truncate">{label}</div>
        <div className="text-[11px] text-text-tertiary truncate">{description}</div>
      </div>
      <button
        type="button"
        onClick={onClick}
        className="flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-apple border border-border-light text-text-secondary hover:bg-error/5 hover:text-error hover:border-error/30 transition-colors"
      >
        <Trash2 size={11} />
        {clearedFlag ? t("settings.cleared") : t("settings.clear")}
      </button>
    </div>
  );
}
