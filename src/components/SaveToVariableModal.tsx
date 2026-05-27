import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { X, Variable } from "lucide-react";
import { useRequestStore } from "../store/useRequestStore";
import { evaluateJsonPath } from "../utils/jsonPath";
import type { ResponseData } from "../types";

interface Props {
  /** The response we're saving from. Captured at modal open time so the
   *  user can't accidentally save the next request's body. */
  response: ResponseData;
  /** Optional JSONPath to pre-fill (e.g. the one the user already has
   *  active in the body view). Empty string = save the whole body. */
  initialJsonPath?: string;
  /** Close the modal without saving. */
  onClose: () => void;
  /** Called after a successful save. */
  onSaved?: (info: { envId: string; key: string }) => void;
}

/**
 * Modal that lets the user pluck a value out of the active response and
 * persist it to a variable in one of their environments. The typical
 * workflow is:
 *   1. Send a login request, get back `{"token":"abc"}`
 *   2. Open this modal, leave JSONPath as `$.token`
 *   3. Pick `Staging`, set key = `authToken`
 *   4. Now downstream requests can reference `{{authToken}}`.
 *
 * Mirrors the styling of `SaveToCollectionModal`.
 */
export function SaveToVariableModal({
  response,
  initialJsonPath = "",
  onClose,
  onSaved,
}: Props) {
  const { t } = useTranslation();
  const environments = useRequestStore((s) => s.environments);
  const workspace = useRequestStore((s) => s.workspace);
  const updateEnvironment = useRequestStore((s) => s.updateEnvironment);

  // Default to the active workspace environment, falling back to the
  // first env in the list when nothing's active. If the user has no
  // environments at all the modal still renders, but with the Save
  // button disabled and an inline hint.
  const [envId, setEnvId] = useState<string>(() => {
    const active = workspace?.active_environment_id;
    if (active && environments.some((e) => e.id === active)) return active;
    return environments[0]?.id ?? "";
  });
  const [key, setKey] = useState("");
  const [jsonPath, setJsonPath] = useState(initialJsonPath);
  const [isSecret, setIsSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedBody = useMemo<unknown>(() => {
    if (response.body_encoding === "base64") return undefined;
    try {
      return JSON.parse(response.body) as unknown;
    } catch {
      return undefined;
    }
  }, [response]);

  /**
   * Compute the value we'd actually save, given the current JSONPath.
   * Three cases:
   *   - No JSONPath  → use the raw body (or "" for binary bodies).
   *   - JSONPath set, body is JSON → evaluate it; objects/arrays get
   *     re-serialized so they round-trip through `{{var}}` substitution
   *     correctly.
   *   - JSONPath set but body isn't JSON → surface as an error so the
   *     user knows the path won't apply, instead of silently saving the
   *     raw body.
   */
  const extracted = useMemo<{ value: string; error: string | null }>(() => {
    if (!jsonPath.trim()) {
      if (response.body_encoding === "base64") {
        return {
          value: "",
          error: t("save_variable.error_binary_no_path"),
        };
      }
      return { value: response.body, error: null };
    }
    if (parsedBody === undefined) {
      return {
        value: "",
        error: t("save_variable.error_path_on_non_json"),
      };
    }
    try {
      const v = evaluateJsonPath(parsedBody, jsonPath);
      if (v === undefined) {
        return { value: "", error: t("save_variable.error_path_no_match") };
      }
      const text =
        typeof v === "string" ? v : JSON.stringify(v);
      return { value: text, error: null };
    } catch (e) {
      return {
        value: "",
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }, [jsonPath, parsedBody, response, t]);

  const canSave = useMemo(
    () =>
      !saving &&
      envId !== "" &&
      key.trim().length > 0 &&
      extracted.error === null,
    [saving, envId, key, extracted],
  );

  const onSubmit = async () => {
    if (!canSave) return;
    const env = environments.find((e) => e.id === envId);
    if (!env) {
      setError(t("save_variable.error_env_missing"));
      return;
    }
    setSaving(true);
    setError(null);
    const trimmedKey = key.trim();
    // Merge into the existing variables: if a variable with this key
    // already exists we overwrite the value (and keep is_secret as set
    // by the user); otherwise we append a new one.
    const existing = env.variables.findIndex((v) => v.key === trimmedKey);
    const nextVars =
      existing >= 0
        ? env.variables.map((v, i) =>
            i === existing
              ? { ...v, value: extracted.value, enabled: true, is_secret: isSecret }
              : v,
          )
        : [
            ...env.variables,
            {
              key: trimmedKey,
              value: extracted.value,
              enabled: true,
              is_secret: isSecret,
            },
          ];
    try {
      await updateEnvironment({ ...env, variables: nextVars });
      onSaved?.({ envId, key: trimmedKey });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  const previewValue = extracted.error ? "" : extracted.value;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-surface rounded-apple-lg shadow-apple-lg w-[520px] max-w-[92vw] max-h-[85vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-light">
          <div className="flex items-center gap-2">
            <Variable size={18} className="text-accent" />
            <h2 className="text-[15px] font-semibold text-text-primary">
              {t("save_variable.title")}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-surface-secondary transition-colors"
          >
            <X size={16} className="text-text-tertiary" />
          </button>
        </div>

        <div className="px-5 pt-4 pb-2">
          <label className="text-[12px] font-medium text-text-secondary block mb-1.5">
            {t("save_variable.environment")}
          </label>
          {environments.length === 0 ? (
            <div className="text-[12px] text-text-tertiary border border-border-light rounded-md px-3 py-2.5">
              {t("save_variable.no_environments")}
            </div>
          ) : (
            <select
              value={envId}
              onChange={(e) => setEnvId(e.target.value)}
              className="input-apple w-full text-[12px]"
            >
              {environments.map((env) => (
                <option key={env.id} value={env.id}>
                  {env.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="px-5 pb-2">
          <label className="text-[12px] font-medium text-text-secondary block mb-1.5">
            {t("save_variable.variable_name")}
          </label>
          <input
            type="text"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={t("save_variable.variable_name_placeholder")}
            className="input-apple w-full text-[12px] font-mono"
          />
        </div>

        <div className="px-5 pb-2">
          <label className="text-[12px] font-medium text-text-secondary block mb-1.5">
            {t("save_variable.json_path")}
          </label>
          <input
            type="text"
            value={jsonPath}
            onChange={(e) => setJsonPath(e.target.value)}
            placeholder="$.token  ·  $.items[0].id  ·  (empty = whole body)"
            className="input-apple w-full text-[12px] font-mono"
          />
        </div>

        <div className="px-5 pb-2">
          <div className="text-[12px] font-medium text-text-secondary mb-1.5">
            {t("save_variable.preview")}
          </div>
          <div className="bg-surface-secondary rounded-md px-3 py-2 text-[11px] font-mono text-text-secondary max-h-[120px] overflow-auto">
            {extracted.error ? (
              <span className="text-error">{extracted.error}</span>
            ) : previewValue.length === 0 ? (
              <span className="text-text-tertiary italic">
                {t("save_variable.preview_empty")}
              </span>
            ) : (
              previewValue.slice(0, 2000)
            )}
            {!extracted.error && previewValue.length > 2000 && (
              <span className="text-text-tertiary"> …</span>
            )}
          </div>
        </div>

        <div className="px-5 pb-2 flex items-center gap-2">
          <input
            id="save-var-secret"
            type="checkbox"
            checked={isSecret}
            onChange={(e) => setIsSecret(e.target.checked)}
          />
          <label
            htmlFor="save-var-secret"
            className="text-[12px] text-text-secondary cursor-pointer"
          >
            {t("save_variable.mark_secret")}
          </label>
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
