import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ResponseSnapshot } from "../types";
import { diffLines, diffHeaders } from "../utils/diff";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Props {
  snapshots: ResponseSnapshot[];
  /** Snapshot id to seed the "left" (older) selector; defaults to the second snapshot. */
  initialLeftId?: string;
  /** Snapshot id to seed the "right" (newer) selector; defaults to the first snapshot. */
  initialRightId?: string;
  onClose: () => void;
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return `${d.toLocaleTimeString()} (${d.toLocaleDateString()})`;
}

function decodeBody(body: string, encoding: "text" | "base64"): string {
  if (encoding === "text") return body;
  // Base64 → display a placeholder; comparing binary line-by-line is meaningless.
  return `[binary body, ${body.length} base64 chars]`;
}

/** Pretty-print JSON if applicable; otherwise return as-is. */
function maybePrettyJson(body: string, contentType: string): string {
  if (!/json/i.test(contentType)) return body;
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

export function ResponseDiffModal({
  snapshots,
  initialLeftId,
  initialRightId,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const ordered = snapshots; // already newest-first
  const [leftId, setLeftId] = useState<string>(
    initialLeftId ?? ordered[1]?.id ?? ordered[0]?.id ?? "",
  );
  const [rightId, setRightId] = useState<string>(
    initialRightId ?? ordered[0]?.id ?? "",
  );

  const left = ordered.find((s) => s.id === leftId);
  const right = ordered.find((s) => s.id === rightId);

  const lineDiff = useMemo(() => {
    if (!left || !right) return [];
    const leftCT = left.response.headers["content-type"] ?? "";
    const rightCT = right.response.headers["content-type"] ?? "";
    const leftBody = maybePrettyJson(
      decodeBody(left.response.body, left.response.body_encoding),
      leftCT,
    );
    const rightBody = maybePrettyJson(
      decodeBody(right.response.body, right.response.body_encoding),
      rightCT,
    );
    return diffLines(leftBody, rightBody);
  }, [left, right]);

  const headerDiff = useMemo(() => {
    if (!left || !right) return null;
    return diffHeaders(left.response.headers, right.response.headers);
  }, [left, right]);

  const addedCount = lineDiff.filter((l) => l.op === "added").length;
  const removedCount = lineDiff.filter((l) => l.op === "removed").length;

  const optionLabel = (s: ResponseSnapshot, i: number) =>
    `#${ordered.length - i} · ${s.response.status} · ${s.response.time_ms}ms · ${formatTimestamp(s.takenAt)}`;

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="flex h-[80vh] w-[95vw] max-w-[1100px] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-4 py-3 text-left">
          <DialogTitle className="text-[13px]">{t("diff.title")}</DialogTitle>
        </DialogHeader>

        {/* Selectors */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-2">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {t("diff.left")}
            <Select value={leftId} onValueChange={setLeftId}>
              <SelectTrigger className="h-7 w-auto min-w-[240px] px-2 text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ordered.map((s, i) => (
                  <SelectItem key={s.id} value={s.id} className="text-[11px]">
                    {optionLabel(s, i)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {t("diff.right")}
            <Select value={rightId} onValueChange={setRightId}>
              <SelectTrigger className="h-7 w-auto min-w-[240px] px-2 text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ordered.map((s, i) => (
                  <SelectItem key={s.id} value={s.id} className="text-[11px]">
                    {optionLabel(s, i)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <span className="ml-auto text-[11px] text-muted-foreground">
            <span className="text-success">+{addedCount}</span>{" "}
            <span className="text-destructive">-{removedCount}</span>
          </span>
        </div>

        {!left || !right ? (
          <div className="flex flex-1 items-center justify-center text-[12px] text-muted-foreground">
            {t("diff.select_both")}
          </div>
        ) : (
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* Status / time summary */}
            <div className="grid grid-cols-2 border-b border-border text-[11px]">
              <div className="border-r border-border bg-muted/70 px-3 py-2">
                <span className="text-muted-foreground">{t("diff.status")} </span>
                <span className="font-mono">{left.response.status}</span>
                <span className="ml-3 text-muted-foreground">{t("diff.time")} </span>
                <span className="font-mono">{left.response.time_ms}ms</span>
                <span className="ml-3 text-muted-foreground">{t("diff.size")} </span>
                <span className="font-mono">{left.response.size_bytes}B</span>
              </div>
              <div className="bg-muted/70 px-3 py-2">
                <span className="text-muted-foreground">{t("diff.status")} </span>
                <span className="font-mono">{right.response.status}</span>
                <span className="ml-3 text-muted-foreground">{t("diff.time")} </span>
                <span className="font-mono">{right.response.time_ms}ms</span>
                <span className="ml-3 text-muted-foreground">{t("diff.size")} </span>
                <span className="font-mono">{right.response.size_bytes}B</span>
              </div>
            </div>

            {/* Headers diff */}
            {headerDiff &&
              (headerDiff.added.length > 0 ||
                headerDiff.removed.length > 0 ||
                headerDiff.changed.length > 0) && (
                <div className="max-h-[160px] overflow-auto border-b border-border px-3 py-2 font-mono text-[11px]">
                  <div className="mb-1 text-muted-foreground">
                    {t("diff.headers")}
                  </div>
                  {headerDiff.removed.map((h) => (
                    <div key={`r-${h.key}`} className="text-destructive">
                      - {h.key}: {h.value}
                    </div>
                  ))}
                  {headerDiff.added.map((h) => (
                    <div key={`a-${h.key}`} className="text-success">
                      + {h.key}: {h.value}
                    </div>
                  ))}
                  {headerDiff.changed.map((h) => (
                    <div key={`c-${h.key}`}>
                      <div className="text-destructive">
                        - {h.key}: {h.left}
                      </div>
                      <div className="text-success">
                        + {h.key}: {h.right}
                      </div>
                    </div>
                  ))}
                </div>
              )}

            {/* Body diff */}
            <div className="flex-1 overflow-auto font-mono text-[11px] leading-[1.5]">
              {lineDiff.length === 0 ? (
                <div className="px-3 py-4 text-muted-foreground">
                  {t("diff.identical")}
                </div>
              ) : (
                lineDiff.map((line, idx) => {
                  const bg =
                    line.op === "added"
                      ? "bg-success/10"
                      : line.op === "removed"
                        ? "bg-destructive/10"
                        : "";
                  const prefix =
                    line.op === "added"
                      ? "+"
                      : line.op === "removed"
                        ? "-"
                        : " ";
                  const color =
                    line.op === "added"
                      ? "text-success"
                      : line.op === "removed"
                        ? "text-destructive"
                        : "text-muted-foreground";
                  return (
                    <div key={idx} className={`flex ${bg}`}>
                      <span className="w-10 shrink-0 select-none px-1 text-right text-muted-foreground">
                        {line.leftNo ?? ""}
                      </span>
                      <span className="w-10 shrink-0 select-none px-1 text-right text-muted-foreground">
                        {line.rightNo ?? ""}
                      </span>
                      <span className={`w-4 shrink-0 select-none ${color}`}>
                        {prefix}
                      </span>
                      <span
                        className={`flex-1 whitespace-pre-wrap break-all ${color}`}
                      >
                        {line.text}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
