import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Eye } from "lucide-react";
import { substituteAll } from "../utils/dynamicVars";

interface VariablePreviewProps {
  /** Raw text that may contain `{{var}}` / `{{$dyn}}` tokens. */
  value: string;
  /** Resolved variable map (already merged with scope precedence). */
  vars: Record<string, string>;
}

/** Extract `{{name}}` tokens preserving original order; deduped. */
function extractTokens(s: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /\{\{([^}]+)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const key = m[1].trim();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

/**
 * Eye icon button that appears next to an input. When the underlying value
 * contains any `{{...}}` tokens, hovering or clicking reveals a popover
 * showing the fully-substituted result plus a per-token resolution table —
 * so the user can quickly see which env / scope each variable came from
 * before sending.
 */
export function VariablePreview({ value, vars }: VariablePreviewProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const tokens = useMemo(() => extractTokens(value), [value]);
  const resolved = useMemo(
    () => substituteAll(value, (k) => vars[k]),
    [value, vars],
  );

  if (tokens.length === 0) return null;

  // Mark a token as "unresolved" when substituteAll left the placeholder
  // intact in the output — clearer than checking `vars[k] === undefined`
  // because it also catches dynamic vars that failed to evaluate.
  const isUnresolved = (k: string) => resolved.includes(`{{${k}}}`);
  const anyUnresolved = tokens.some(isUnresolved);

  return (
    <div className="relative">
      <button
        type="button"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
        className={`w-7 h-7 flex items-center justify-center rounded-lg transition-colors ${
          anyUnresolved ? "text-warning" : "text-primary"
        } hover:bg-accent`}
        title={
          anyUnresolved
            ? t("variable_preview.has_unresolved")
            : t("variable_preview.title")
        }
      >
        <Eye size={14} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-[420px] max-h-[320px] overflow-auto z-50 rounded-xl border border-border bg-card shadow-lg p-3 text-[11px]">
          <div className="font-semibold text-muted-foreground mb-1">
            {t("variable_preview.resolved_value")}
          </div>
          <div className="font-mono text-foreground break-all bg-muted rounded-lg p-2 mb-2 whitespace-pre-wrap">
            {resolved || t("variable_preview.empty")}
          </div>
          <div className="font-semibold text-muted-foreground mb-1">
            {t("variable_preview.variables_n", { count: tokens.length })}
          </div>
          <div className="divide-y divide-border-border">
            {tokens.map((k) => {
              const unresolved = isUnresolved(k);
              const v = vars[k];
              return (
                <div key={k} className="flex items-start gap-2 py-1">
                  <span
                    className={`font-mono shrink-0 ${unresolved ? "text-warning" : "text-primary"}`}
                  >{`{{${k}}}`}</span>
                  <span className="font-mono text-muted-foreground break-all flex-1 text-right">
                    {unresolved
                      ? k.startsWith("$")
                        ? t("variable_preview.unknown_dynamic")
                        : t("variable_preview.undefined")
                      : v ?? ""}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
