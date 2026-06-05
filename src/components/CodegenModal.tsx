import { useMemo, useState } from "react";
import { Copy, Check, Code2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  CODEGEN_TARGETS,
  generateCode,
  type CodegenTarget,
} from "../utils/codegen";
import type { RequestItem } from "../types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function CodegenModal({
  request,
  onClose,
}: {
  request: RequestItem;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [target, setTarget] = useState<CodegenTarget>("fetch");
  const [copied, setCopied] = useState(false);

  const code = useMemo(() => {
    try {
      return generateCode(request, target);
    } catch (err) {
      return `// ${t("codegen.error_prefix")}: ${String(err)}`;
    }
  }, [request, target, t]);

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="flex max-h-[80vh] max-w-[720px] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 py-4 text-left">
          <DialogTitle className="flex items-center gap-2 text-[15px]">
            <Code2 size={18} className="text-primary" />
            {t("codegen.title")}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
          {CODEGEN_TARGETS.map((tgt) => (
            <Button
              key={tgt.value}
              size="sm"
              variant={target === tgt.value ? "default" : "secondary"}
              className="h-7 px-2.5 text-[11px]"
              onClick={() => setTarget(tgt.value)}
            >
              {tgt.label}
            </Button>
          ))}
        </div>

        <div className="relative flex-1 overflow-auto bg-muted p-4">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              navigator.clipboard.writeText(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className="absolute right-3 top-3 h-7 gap-1 px-2 text-[11px] shadow-sm"
          >
            {copied ? (
              <Check size={12} className="text-success" />
            ) : (
              <Copy size={12} />
            )}
            {copied ? t("codegen.copied") : t("codegen.copy")}
          </Button>
          <pre className="whitespace-pre-wrap break-all font-mono text-[12px] leading-[1.65] text-foreground">
            {code}
          </pre>
        </div>
      </DialogContent>
    </Dialog>
  );
}
