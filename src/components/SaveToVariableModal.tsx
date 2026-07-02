import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Variable } from "lucide-react";
import { useRequestStore } from "../store/useRequestStore";
import { evaluateJsonPath } from "../utils/jsonPath";
import type { ResponseData } from "../types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
      const text = typeof v === "string" ? v : JSON.stringify(v);
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
              ? {
                  ...v,
                  value: extracted.value,
                  enabled: true,
                  is_secret: isSecret,
                }
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

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="flex max-h-[85vh] max-w-[520px] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 py-4 text-left">
          <DialogTitle className="flex items-center gap-2 text-[15px]">
            <Variable size={18} className="text-primary" />
            {t("save_variable.title")}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-auto">
          <div className="px-5 pb-2 pt-4">
            <Label className="mb-1.5 block text-[12px] text-muted-foreground">
              {t("save_variable.environment")}
            </Label>
            {environments.length === 0 ? (
              <div className="rounded-md border border-border px-3 py-2.5 text-[12px] text-muted-foreground">
                {t("save_variable.no_environments")}
              </div>
            ) : (
              <Select value={envId} onValueChange={setEnvId}>
                <SelectTrigger className="h-9 w-full text-[12px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {environments.map((env) => (
                    <SelectItem key={env.id} value={env.id} className="text-[12px]">
                      {env.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="px-5 pb-2">
            <Label
              htmlFor="save-var-key"
              className="mb-1.5 block text-[12px] text-muted-foreground"
            >
              {t("save_variable.variable_name")}
            </Label>
            <Input
              id="save-var-key"
              type="text"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={t("save_variable.variable_name_placeholder")}
              className="h-9 font-mono text-[12px]"
            />
          </div>

          <div className="px-5 pb-2">
            <Label
              htmlFor="save-var-path"
              className="mb-1.5 block text-[12px] text-muted-foreground"
            >
              {t("save_variable.json_path")}
            </Label>
            <Input
              id="save-var-path"
              type="text"
              value={jsonPath}
              onChange={(e) => setJsonPath(e.target.value)}
              placeholder={t("save_variable.json_path_placeholder")}
              className="h-9 font-mono text-[12px]"
            />
          </div>

          <div className="px-5 pb-2">
            <div className="mb-1.5 text-[12px] font-medium text-muted-foreground">
              {t("save_variable.preview")}
            </div>
            <div className="max-h-[120px] overflow-auto rounded-md bg-muted px-3 py-2 font-mono text-[11px] text-muted-foreground">
              {extracted.error ? (
                <span className="text-destructive">{extracted.error}</span>
              ) : previewValue.length === 0 ? (
                <span className="italic text-muted-foreground">
                  {t("save_variable.preview_empty")}
                </span>
              ) : (
                previewValue.slice(0, 2000)
              )}
              {!extracted.error && previewValue.length > 2000 && (
                <span className="text-muted-foreground"> …</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 px-5 pb-2">
            <Checkbox
              id="save-var-secret"
              checked={isSecret}
              onCheckedChange={(c) => setIsSecret(c === true)}
            />
            <Label
              htmlFor="save-var-secret"
              className="cursor-pointer text-[12px] text-muted-foreground"
            >
              {t("save_variable.mark_secret")}
            </Label>
          </div>

          {error && (
            <div className="px-5 pb-2 text-[11px] text-destructive">{error}</div>
          )}
        </div>

        <DialogFooter className="border-t border-border px-5 py-4">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" onClick={onSubmit} disabled={!canSave}>
            {saving ? t("common.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
