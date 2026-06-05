import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  buildScopedVarsWithSource,
  type VarSource,
} from "../utils/variableScope";
import type { Collection, Environment, RequestItem, Workspace } from "../types";

/** Source-layer accent colors, aligned with the app's METHOD_COLORS / tag
 *  palette so the precedence is glanceable. */
const SOURCE_COLOR: Record<VarSource, string> = {
  global: "text-muted-foreground",
  collection: "text-primary",
  folder: "text-orange",
  environment: "text-success",
};

interface Props {
  request: RequestItem;
  workspace: Workspace | null;
  collections: Collection[];
  environments: Environment[];
  onClose: () => void;
}

/**
 * Read-only inspector that shows every variable visible to the active request
 * and which scope layer supplied its winning value — the answer to "why didn't
 * `{{token}}` get substituted?". Mirrors `requestPipeline`'s precedence minus
 * transient script overrides (which don't exist until pre-scripts run).
 */
export function ResolvedVariablesModal({
  request,
  workspace,
  collections,
  environments,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const vars = buildScopedVarsWithSource({
    workspace,
    collections,
    environments,
    request,
  });

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="flex max-h-[80vh] w-[92vw] max-w-[640px] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 py-3 text-left">
          <DialogTitle className="text-base">
            {t("resolved_vars.title")}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            {t("resolved_vars.hint")}
          </p>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          {vars.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {t("resolved_vars.empty")}
            </div>
          ) : (
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-2 py-1 font-medium">
                    {t("resolved_vars.col_name")}
                  </th>
                  <th className="px-2 py-1 font-medium">
                    {t("resolved_vars.col_value")}
                  </th>
                  <th className="px-2 py-1 font-medium">
                    {t("resolved_vars.col_source")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {vars.map((v) => (
                  <tr key={v.key} className="border-t border-border/60">
                    <td className="px-2 py-1.5 align-top font-mono text-foreground">
                      {v.key}
                    </td>
                    <td className="px-2 py-1.5 align-top font-mono text-muted-foreground break-all">
                      {v.value || (
                        <span className="italic opacity-60">
                          {t("resolved_vars.empty_value")}
                        </span>
                      )}
                    </td>
                    <td
                      className={`whitespace-nowrap px-2 py-1.5 align-top ${SOURCE_COLOR[v.source]}`}
                    >
                      {t(`resolved_vars.source_${v.source}`)}
                      {v.origin ? ` · ${v.origin}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
