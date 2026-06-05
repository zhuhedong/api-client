import { useState } from "react";
import {
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
import { getThemeMode, setThemeMode, type ThemeMode } from "../utils/theme";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
  const setMaxHistoryBodyBytes = useRequestStore(
    (s) => s.setMaxHistoryBodyBytes,
  );
  const defaultRedirectPolicy = useRequestStore((s) => s.defaultRedirectPolicy);
  const setDefaultRedirectPolicy = useRequestStore(
    (s) => s.setDefaultRedirectPolicy,
  );
  const defaultMaxRedirects = useRequestStore((s) => s.defaultMaxRedirects);
  const setDefaultMaxRedirects = useRequestStore(
    (s) => s.setDefaultMaxRedirects,
  );
  const defaultProxyUrl = useRequestStore((s) => s.defaultProxyUrl);
  const setDefaultProxyUrl = useRequestStore((s) => s.setDefaultProxyUrl);
  const clearAllHistory = useRequestStore((s) => s.clearAllHistory);
  const clearAllRecent = useRequestStore((s) => s.clearAllRecent);
  const clearAllCookies = useRequestStore((s) => s.clearAllCookies);

  const [value, setValue] = useState(String(defaultTimeoutMs));
  const [maxBodyMiB, setMaxBodyMiB] = useState(
    String(Math.max(1, Math.round(maxBodyBytes / MIB))),
  );
  const [maxHistoryBodyKiB, setMaxHistoryBodyKiB] = useState(
    String(Math.max(1, Math.round(maxHistoryBodyBytes / 1024))),
  );
  const [proxyDraft, setProxyDraft] = useState(defaultProxyUrl);
  const [maxRedirectsDraft, setMaxRedirectsDraft] = useState(
    String(defaultMaxRedirects),
  );
  const [saved, setSaved] = useState(false);
  const [savedMaxBody, setSavedMaxBody] = useState(false);
  const [savedHistBody, setSavedHistBody] = useState(false);
  const [savedProxy, setSavedProxy] = useState(false);
  const [savedRedirects, setSavedRedirects] = useState(false);
  // Theme mode is stored in localStorage rather than the request store
  // (it pre-renders before React mounts to avoid a flash of the wrong
  // theme). We mirror it into local state so the dropdown stays in sync.
  const [themeMode, setLocalThemeMode] = useState<ThemeMode>(() =>
    getThemeMode(),
  );
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

  const clearLabels: Record<
    Exclude<ClearTarget, null>,
    { title: string; message: string }
  > = {
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

  const themeOptions = [
    ["light", t("settings.theme_light"), <Sun key="s" size={13} />],
    ["dark", t("settings.theme_dark"), <Moon key="m" size={13} />],
    ["system", t("settings.theme_system"), <Monitor key="d" size={13} />],
  ] as const;

  return (
    <>
      <Dialog
        open
        onOpenChange={(next) => {
          if (!next) onClose();
        }}
      >
        <DialogContent className="flex max-h-[85vh] max-w-[520px] flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b border-border px-5 py-4 text-left">
            <DialogTitle className="flex items-center gap-2 text-[15px]">
              <SettingsIcon size={18} className="text-primary" />
              {t("settings.settings")}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5 overflow-y-auto p-5">
            {/* Appearance */}
            <section className="space-y-3">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t("settings.appearance")}
              </h3>

              <div>
                <Label className="mb-1.5 block text-[12px] text-muted-foreground">
                  {t("settings.language")}
                </Label>
                <Select
                  value={currentLocale}
                  onValueChange={(v) => setLocale(v as Locale)}
                >
                  <SelectTrigger className="h-9 w-full text-[12px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SUPPORTED_LOCALES.map((loc) => (
                      <SelectItem key={loc} value={loc} className="text-[12px]">
                        {loc === "en"
                          ? t("settings.language_english")
                          : t("settings.language_chinese")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="mb-1.5 block text-[12px] text-muted-foreground">
                  {t("settings.theme")}
                </Label>
                <div className="flex items-center gap-1.5">
                  {themeOptions.map(([mode, label, icon]) => (
                    <Button
                      key={mode}
                      type="button"
                      size="sm"
                      variant={themeMode === mode ? "default" : "outline"}
                      onClick={() => handleThemeChange(mode)}
                      aria-pressed={themeMode === mode}
                      className="h-8 gap-1.5 text-[12px]"
                    >
                      {icon}
                      {label}
                    </Button>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {t("settings.theme_hint")}
                </p>
              </div>
            </section>

            {/* Behavior */}
            <section className="space-y-3 pt-1">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t("settings.behavior")}
              </h3>

              <div>
                <Label className="mb-1.5 block text-[12px] text-muted-foreground">
                  {t("settings.default_timeout")}
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    min={1}
                    className="h-9 flex-1 text-[12px]"
                  />
                  <Button size="sm" onClick={save}>
                    {saved ? t("common.saved") : t("common.save")}
                  </Button>
                </div>
              </div>

              <div>
                <Label className="mb-1.5 block text-[12px] text-muted-foreground">
                  {t("settings.default_redirect_policy")}
                </Label>
                <Select
                  value={defaultRedirectPolicy}
                  onValueChange={(v) =>
                    setDefaultRedirectPolicy(v as "follow" | "none" | "manual")
                  }
                >
                  <SelectTrigger className="h-9 w-full text-[12px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="follow" className="text-[12px]">
                      {t("settings.redirect_follow")}
                    </SelectItem>
                    <SelectItem value="manual" className="text-[12px]">
                      {t("settings.redirect_manual")}
                    </SelectItem>
                    <SelectItem value="none" className="text-[12px]">
                      {t("settings.redirect_none")}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {t("settings.default_redirect_hint")}
                </p>
              </div>

              <div>
                <Label className="mb-1.5 block text-[12px] text-muted-foreground">
                  {t("settings.default_max_redirects")}
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    value={maxRedirectsDraft}
                    onChange={(e) => setMaxRedirectsDraft(e.target.value)}
                    min={0}
                    max={100}
                    disabled={defaultRedirectPolicy !== "follow"}
                    className="h-9 flex-1 text-[12px]"
                  />
                  <Button
                    size="sm"
                    onClick={saveMaxRedirects}
                    disabled={defaultRedirectPolicy !== "follow"}
                  >
                    {savedRedirects ? t("common.saved") : t("common.save")}
                  </Button>
                </div>
              </div>

              <div>
                <Label className="mb-1.5 block text-[12px] text-muted-foreground">
                  {t("settings.default_proxy_url")}
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="text"
                    value={proxyDraft}
                    onChange={(e) => setProxyDraft(e.target.value)}
                    placeholder={t("settings.default_proxy_url_placeholder")}
                    className="h-9 flex-1 font-mono text-[12px]"
                    spellCheck={false}
                  />
                  <Button size="sm" onClick={saveProxy}>
                    {savedProxy ? t("common.saved") : t("common.save")}
                  </Button>
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {t("settings.default_proxy_url_hint")}
                </p>
              </div>

              <div>
                <Label className="mb-1.5 block text-[12px] text-muted-foreground">
                  {t("settings.max_body_bytes")}
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    value={maxBodyMiB}
                    onChange={(e) => setMaxBodyMiB(e.target.value)}
                    min={1}
                    max={1024}
                    className="h-9 flex-1 text-[12px]"
                  />
                  <span className="w-8 shrink-0 text-[11px] text-muted-foreground">
                    MiB
                  </span>
                  <Button size="sm" onClick={saveMaxBody}>
                    {savedMaxBody ? t("common.saved") : t("common.save")}
                  </Button>
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {t("settings.max_body_bytes_hint")}
                </p>
              </div>

              <div>
                <Label className="mb-1.5 block text-[12px] text-muted-foreground">
                  {t("settings.max_history_body_bytes")}
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    value={maxHistoryBodyKiB}
                    onChange={(e) => setMaxHistoryBodyKiB(e.target.value)}
                    min={0}
                    max={10240}
                    className="h-9 flex-1 text-[12px]"
                  />
                  <span className="w-8 shrink-0 text-[11px] text-muted-foreground">
                    KiB
                  </span>
                  <Button size="sm" onClick={saveHistBody}>
                    {savedHistBody ? t("common.saved") : t("common.save")}
                  </Button>
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {t("settings.max_history_body_bytes_hint")}
                </p>
              </div>

              <div>
                <Label className="mb-1.5 block text-[12px] text-muted-foreground">
                  {t("settings.verify_tls_default")}
                </Label>
                <div className="flex items-center gap-3">
                  <Switch
                    checked={verifyTlsDefault}
                    onCheckedChange={setVerifyTlsDefault}
                    aria-label={t("settings.verify_tls_default")}
                  />
                  <div className="flex items-center gap-1.5 text-[12px]">
                    {verifyTlsDefault ? (
                      <>
                        <ShieldCheck size={14} className="text-success" />
                        <span className="text-foreground">
                          {t("settings.tls_on")}
                        </span>
                      </>
                    ) : (
                      <>
                        <ShieldAlert size={14} className="text-warning" />
                        <span className="text-warning">
                          {t("settings.tls_off")}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </section>

            {/* Data management */}
            <section className="space-y-2 pt-1">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t("settings.data")}
              </h3>
              <p className="text-[11px] text-muted-foreground">
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
        </DialogContent>
      </Dialog>

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
    </>
  );
}

interface ClearRowProps {
  label: string;
  description: string;
  clearedFlag: boolean;
  onClick: () => void;
  t: (k: string) => string;
}

function ClearRow({
  label,
  description,
  clearedFlag,
  onClick,
  t,
}: ClearRowProps) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] text-foreground">{label}</div>
        <div className="truncate text-[11px] text-muted-foreground">
          {description}
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onClick}
        className="h-8 gap-1 text-[11px] text-muted-foreground hover:border-destructive/30 hover:bg-destructive/5 hover:text-destructive"
      >
        <Trash2 size={11} />
        {clearedFlag ? t("settings.cleared") : t("settings.clear")}
      </Button>
    </div>
  );
}
