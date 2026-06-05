import { useMemo, useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Plus,
  X,
  GripVertical,
  Paperclip,
  FileText,
  Maximize2,
  Minimize2,
  List,
  Type,
  Check,
  CircleSlash,
} from "lucide-react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import type { KeyValue } from "../types";
import { VariablePreview } from "./VariablePreview";
import { parseKeyValues, serializeKeyValues } from "../utils/kvBulk";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

interface KeyValueEditorProps {
  items: KeyValue[];
  onChange: (items: KeyValue[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  /** When true, each row may be toggled to a file upload (form-data only). */
  allowFiles?: boolean;
  /** When true, rows can be reordered via drag-and-drop. */
  reorderable?: boolean;
  /**
   * Scope used for the inline `{{var}}` preview. When omitted, the preview
   * eye-icon is hidden (callers without a meaningful resolution scope shouldn't
   * pretend they have one — Mock route headers, for example).
   */
  previewVars?: Record<string, string>;
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

/** Threshold above which the bulk-toggle (enable/disable all) buttons
 *  start appearing. Keeps the toolbar from looking busy for the common
 *  short-row case. */
const BULK_TOOLBAR_MIN_ROWS = 3;

export function KeyValueEditor({
  items,
  onChange,
  keyPlaceholder,
  valuePlaceholder,
  allowFiles = false,
  reorderable = true,
  previewVars,
}: KeyValueEditorProps) {
  const { t } = useTranslation();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  /** IDs of rows the user has expanded to a multi-line textarea. */
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkText, setBulkText] = useState("");
  // Keyboard flow: Enter on a value adds/advances a row, Backspace on a fully
  // empty row deletes it. Inputs are focused by a "<id>:key" / "<id>:value"
  // handle once the controlled `items` re-render has landed.
  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  const refKey = (id: string, field: "key" | "value") => `${id}:${field}`;
  const setInputRef = (key: string, el: HTMLInputElement | null) => {
    if (el) inputRefs.current.set(key, el);
    else inputRefs.current.delete(key);
  };
  useEffect(() => {
    if (!pendingFocus) return;
    const el = inputRefs.current.get(pendingFocus);
    if (el) {
      el.focus();
      setPendingFocus(null);
    }
  }, [pendingFocus, items]);

  const keyPh = keyPlaceholder ?? t("kv.key_placeholder");
  const valuePh = valuePlaceholder ?? t("kv.value_placeholder");

  const updateItem = (id: string, patch: Partial<KeyValue>) => {
    onChange(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const addItem = () => {
    onChange([...items, { id: generateId(), key: "", value: "", enabled: true }]);
  };

  const removeItem = (id: string) => {
    if (items.length <= 1) {
      // Reset to a single empty row instead of removing the last one so the
      // editor always has at least one focusable input.
      onChange([{ id: generateId(), key: "", value: "", enabled: true }]);
      return;
    }
    onChange(items.filter((item) => item.id !== id));
    setExpandedRows((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const reorder = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    const from = items.findIndex((i) => i.id === fromId);
    const to = items.findIndex((i) => i.id === toId);
    if (from === -1 || to === -1) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  };

  const pickFile = async (id: string) => {
    try {
      const selected = await openFileDialog({ multiple: false });
      if (selected && typeof selected === "string") {
        updateItem(id, { is_file: true, file_path: selected, value: "" });
      }
    } catch (err) {
      console.error("File picker failed:", err);
    }
  };

  const setAllEnabled = (enabled: boolean) => {
    onChange(items.map((item) => ({ ...item, enabled })));
  };

  const toggleExpanded = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** Count of rows the user has actually started filling in. Used to gate
   *  the bulk-mode toggle (otherwise a one-row table looks identical to a
   *  one-row text block and the button is just noise). */
  const meaningfulRows = useMemo(
    () => items.filter((it) => it.key.trim() || it.value.trim()).length,
    [items],
  );

  /** Bulk text mode can't represent file-attachment rows (`is_file`,
   *  `file_path` aren't part of the `key: value` line format). Suppress
   *  the toggle whenever any row is a file row so we don't silently lose
   *  the attachment on a round-trip through the textarea. */
  const hasFileRows = useMemo(
    () => items.some((it) => it.is_file),
    [items],
  );
  const bulkAllowed = !hasFileRows;

  const enterBulkMode = () => {
    setBulkText(serializeKeyValues(items));
    setBulkMode(true);
  };

  const applyBulkMode = () => {
    onChange(parseKeyValues(bulkText));
    setBulkMode(false);
  };

  const cancelBulkMode = () => {
    setBulkText("");
    setBulkMode(false);
  };

  if (bulkMode) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">
            {t("kv.bulk_hint")}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={cancelBulkMode}
              className="px-2 py-1 text-[11px] text-muted-foreground rounded-md hover:bg-muted transition-colors"
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={applyBulkMode}
              className="px-2 py-1 text-[11px] bg-primary text-white rounded-md hover:bg-primary/90 transition-colors"
            >
              {t("kv.bulk_apply")}
            </button>
          </div>
        </div>
        <Textarea
          value={bulkText}
          onChange={(e) => setBulkText(e.target.value)}
          placeholder={t("kv.bulk_placeholder")}
          spellCheck={false}
          className="min-h-[180px] w-full resize-y py-2 font-mono text-[12px]"
        />
      </div>
    );
  }

  const allEnabled = items.length > 0 && items.every((it) => it.enabled);
  const showBulkToolbar = items.length >= BULK_TOOLBAR_MIN_ROWS;

  return (
    <div className="space-y-1.5">
      {showBulkToolbar && (
        <div className="flex items-center justify-end gap-1 text-[11px] text-muted-foreground pb-1">
          <button
            onClick={() => setAllEnabled(!allEnabled)}
            className="px-1.5 py-0.5 rounded-md hover:bg-muted flex items-center gap-1 transition-colors"
            title={
              allEnabled
                ? t("kv.disable_all_tooltip")
                : t("kv.enable_all_tooltip")
            }
          >
            {allEnabled ? (
              <CircleSlash size={11} />
            ) : (
              <Check size={11} />
            )}
            {allEnabled ? t("kv.disable_all") : t("kv.enable_all")}
          </button>
          {bulkAllowed && (
            <button
              onClick={enterBulkMode}
              className="px-1.5 py-0.5 rounded-md hover:bg-muted flex items-center gap-1 transition-colors"
              title={t("kv.bulk_edit_tooltip")}
            >
              <Type size={11} />
              {t("kv.bulk_edit")}
            </button>
          )}
        </div>
      )}

      {items.map((item, idx) => {
        const isExpanded = expandedRows.has(item.id);
        const isOver = overId === item.id && draggingId && draggingId !== item.id;
        return (
          <div
            key={item.id}
            draggable={reorderable}
            onDragStart={() => setDraggingId(item.id)}
            onDragOver={(e) => {
              e.preventDefault();
              if (overId !== item.id) setOverId(item.id);
            }}
            onDragLeave={() => {
              if (overId === item.id) setOverId(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (draggingId) reorder(draggingId, item.id);
              setDraggingId(null);
              setOverId(null);
            }}
            onDragEnd={() => {
              setDraggingId(null);
              setOverId(null);
            }}
            className={`flex items-start gap-1.5 group rounded-md transition-colors ${
              isOver ? "bg-primary/5 outline outline-1 outline-primary/40" : ""
            } ${draggingId === item.id ? "opacity-50" : ""}`}
          >
            {reorderable && (
              <span
                className="pt-[7px] cursor-grab active:cursor-grabbing shrink-0"
                title={t("kv.drag_to_reorder")}
              >
                <GripVertical
                  size={12}
                  className="text-muted-foreground/30 group-hover:text-muted-foreground transition-colors"
                />
              </span>
            )}
            <label className="relative flex items-center justify-center w-5 h-7 shrink-0">
              <Checkbox
                checked={item.enabled}
                onCheckedChange={(c) =>
                  updateItem(item.id, { enabled: c === true })
                }
                className="h-[15px] w-[15px]"
                title={
                  item.enabled
                    ? t("kv.toggle_disable")
                    : t("kv.toggle_enable")
                }
              />
            </label>
            <Input
              ref={(el) => setInputRef(refKey(item.id, "key"), el)}
              type="text"
              value={item.key}
              onChange={(e) => updateItem(item.id, { key: e.target.value })}
              onKeyDown={(e) => {
                if (
                  e.key === "Backspace" &&
                  item.key === "" &&
                  item.value === "" &&
                  items.length > 1
                ) {
                  e.preventDefault();
                  const prev = items[idx - 1];
                  removeItem(item.id);
                  if (prev) setPendingFocus(refKey(prev.id, "value"));
                }
              }}
              placeholder={keyPh}
              spellCheck={false}
              className="h-7 w-[180px] text-[12px]"
            />
            {item.is_file ? (
              <div className="flex-1 min-w-0 flex items-center gap-1.5 px-2 py-[5px] bg-muted rounded-lg text-[12px]">
                <FileText size={12} className="text-primary shrink-0" />
                <span
                  className="truncate flex-1 text-foreground"
                  title={item.file_path}
                >
                  {item.file_path?.split(/[\\/]/).pop() || t("kv.select_file")}
                </span>
                <button
                  onClick={() =>
                    updateItem(item.id, { is_file: false, file_path: undefined })
                  }
                  className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                  title={t("kv.switch_back_to_text")}
                >
                  <X size={11} />
                </button>
              </div>
            ) : isExpanded ? (
              <Textarea
                value={item.value}
                onChange={(e) => updateItem(item.id, { value: e.target.value })}
                placeholder={valuePh}
                spellCheck={false}
                rows={3}
                className="min-h-0 min-w-0 flex-1 resize-y py-[5px] font-mono text-[12px]"
              />
            ) : (
              <Input
                ref={(el) => setInputRef(refKey(item.id, "value"), el)}
                type="text"
                value={item.value}
                onChange={(e) => updateItem(item.id, { value: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (idx === items.length - 1) {
                      const id = generateId();
                      onChange([
                        ...items,
                        { id, key: "", value: "", enabled: true },
                      ]);
                      setPendingFocus(refKey(id, "key"));
                    } else {
                      setPendingFocus(refKey(items[idx + 1].id, "key"));
                    }
                  }
                }}
                placeholder={valuePh}
                spellCheck={false}
                className="h-7 min-w-0 flex-1 text-[12px]"
                title={item.value || undefined}
              />
            )}
            {previewVars && !item.is_file && (
              <div className="pt-[1px]">
                <VariablePreview value={item.value} vars={previewVars} />
              </div>
            )}
            {!item.is_file && (
              <button
                onClick={() => toggleExpanded(item.id)}
                className="w-5 h-7 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-100 hover:bg-accent transition-all shrink-0"
                title={
                  isExpanded
                    ? t("kv.collapse_value")
                    : t("kv.expand_value")
                }
              >
                {isExpanded ? (
                  <Minimize2 size={11} className="text-muted-foreground" />
                ) : (
                  <Maximize2 size={11} className="text-muted-foreground" />
                )}
              </button>
            )}
            {allowFiles && (
              <button
                onClick={() => pickFile(item.id)}
                className="w-5 h-7 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-100 hover:bg-primary/10 transition-all shrink-0"
                title={t("kv.attach_file")}
              >
                <Paperclip size={12} className="text-muted-foreground" />
              </button>
            )}
            <button
              onClick={() => removeItem(item.id)}
              className="w-5 h-7 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-100 hover:bg-accent transition-all shrink-0"
              title={t("kv.remove_row")}
            >
              <X size={12} className="text-muted-foreground" />
            </button>
          </div>
        );
      })}
      <div className="flex items-center gap-2 pl-6 pt-0.5">
        <button
          onClick={addItem}
          className="flex items-center gap-1 text-[12px] text-primary hover:text-primary/90 transition-colors py-1"
        >
          <Plus size={12} strokeWidth={2.2} />
          {t("kv.add")}
        </button>
        {!showBulkToolbar && bulkAllowed && meaningfulRows > 0 && (
          <button
            onClick={enterBulkMode}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-muted-foreground transition-colors py-1"
            title={t("kv.bulk_edit_tooltip")}
          >
            <List size={11} />
            {t("kv.bulk_edit")}
          </button>
        )}
      </div>
    </div>
  );
}
