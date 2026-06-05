import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface ConfirmDialogProps {
  /** When `null`/`false`, the dialog is closed. */
  open: boolean;
  /** Dialog title. */
  title: string;
  /**
   * Body text. Newlines are honoured. Pass a longer explanation here when
   * the consequence is non-obvious (e.g. cascade delete).
   */
  message: string;
  /** Label for the destructive action. Defaults to the localized "Delete". */
  confirmLabel?: string;
  /** Label for the safe action. Defaults to the localized "Cancel". */
  cancelLabel?: string;
  /**
   * Style hint for the confirm button. `"danger"` (default) renders red;
   * `"primary"` renders the accent colour for non-destructive confirmations
   * (e.g. discarding unsaved changes).
   */
  variant?: "danger" | "primary";
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Lightweight in-app confirmation dialog, built on the shadcn/ui `Dialog`
 * (Radix). Replaces the browser-native `window.confirm` so confirmations can
 * be styled, themed (dark mode), localized, and shown above other modals
 * without breaking focus.
 *
 * Radix owns the overlay, focus trap, and Esc-to-close (routed to `onCancel`
 * via `onOpenChange`). Cmd/Ctrl+Enter confirms.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  variant = "danger",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        // Cmd/Ctrl+Enter to confirm. Plain Enter activates the focused
        // confirm button via the browser's default behaviour. Esc is handled
        // by Radix and routed to onCancel through onOpenChange.
        e.preventDefault();
        onConfirm();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onConfirm]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      {/* z-[60] keeps confirm above panels that triggered it (panels render at
          the default Radix z-50). */}
      <DialogContent className="z-[60] sm:max-w-[420px]">
        <DialogHeader>
          <div className="flex items-start gap-3 text-left">
            {variant === "danger" && (
              <div className="shrink-0 w-9 h-9 rounded-full bg-destructive/10 flex items-center justify-center">
                <AlertTriangle size={18} className="text-destructive" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription className="mt-1 whitespace-pre-line break-words">
                {message}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {cancelLabel ?? t("common.cancel")}
          </Button>
          <Button
            autoFocus
            size="sm"
            variant={variant === "danger" ? "destructive" : "default"}
            onClick={onConfirm}
          >
            {confirmLabel ?? t("common.delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
