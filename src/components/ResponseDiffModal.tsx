import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ResponseSnapshot } from "../types";
import { diffLines, diffHeaders } from "../utils/diff";

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
    initialLeftId ?? ordered[1]?.id ?? ordered[0]?.id ?? ""
  );
  const [rightId, setRightId] = useState<string>(
    initialRightId ?? ordered[0]?.id ?? ""
  );

  const left = ordered.find((s) => s.id === leftId);
  const right = ordered.find((s) => s.id === rightId);

  const lineDiff = useMemo(() => {
    if (!left || !right) return [];
    const leftCT = left.response.headers["content-type"] ?? "";
    const rightCT = right.response.headers["content-type"] ?? "";
    const leftBody = maybePrettyJson(
      decodeBody(left.response.body, left.response.body_encoding),
      leftCT
    );
    const rightBody = maybePrettyJson(
      decodeBody(right.response.body, right.response.body_encoding),
      rightCT
    );
    return diffLines(leftBody, rightBody);
  }, [left, right]);

  const headerDiff = useMemo(() => {
    if (!left || !right) return null;
    return diffHeaders(left.response.headers, right.response.headers);
  }, [left, right]);

  const addedCount = lineDiff.filter((l) => l.op === "added").length;
  const removedCount = lineDiff.filter((l) => l.op === "removed").length;

  return (
    <div className="fixed inset-0 bg-black/55 flex items-center justify-center z-50">
      <div className="bg-surface border border-border-light rounded-apple shadow-apple-lg w-[1100px] max-w-[95vw] h-[80vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-light bg-surface">
          <h2 className="text-[13px] font-semibold text-text-primary">{t("diff.title")}</h2>
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-black/5"
          >
            <X size={14} className="text-text-tertiary" />
          </button>
        </div>

        {/* Selectors */}
        <div className="flex items-center gap-3 px-4 py-2 border-b border-border-light bg-surface">
          <label className="flex items-center gap-1.5 text-[11px] text-text-secondary">
            {t("diff.left")}
            <select
              value={leftId}
              onChange={(e) => setLeftId(e.target.value)}
              className="input-apple text-[11px] px-2 py-1"
            >
              {ordered.map((s, i) => (
                <option key={s.id} value={s.id}>
                  #{ordered.length - i} · {s.response.status} · {s.response.time_ms}ms ·{" "}
                  {formatTimestamp(s.takenAt)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-text-secondary">
            {t("diff.right")}
            <select
              value={rightId}
              onChange={(e) => setRightId(e.target.value)}
              className="input-apple text-[11px] px-2 py-1"
            >
              {ordered.map((s, i) => (
                <option key={s.id} value={s.id}>
                  #{ordered.length - i} · {s.response.status} · {s.response.time_ms}ms ·{" "}
                  {formatTimestamp(s.takenAt)}
                </option>
              ))}
            </select>
          </label>
          <span className="ml-auto text-[11px] text-text-tertiary">
            <span className="text-success">+{addedCount}</span>{" "}
            <span className="text-error">-{removedCount}</span>
          </span>
        </div>

        {!left || !right ? (
          <div className="flex-1 flex items-center justify-center text-[12px] text-text-tertiary">
            {t("diff.select_both")}
          </div>
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Status / time summary */}
            <div className="grid grid-cols-2 border-b border-border-light text-[11px]">
              <div className="px-3 py-2 border-r border-border-light bg-surface-secondary/70">
                <span className="text-text-tertiary">{t("diff.status")} </span>
                <span className="font-mono">{left.response.status}</span>
                <span className="ml-3 text-text-tertiary">{t("diff.time")} </span>
                <span className="font-mono">{left.response.time_ms}ms</span>
                <span className="ml-3 text-text-tertiary">{t("diff.size")} </span>
                <span className="font-mono">{left.response.size_bytes}B</span>
              </div>
              <div className="px-3 py-2 bg-surface-secondary/70">
                <span className="text-text-tertiary">{t("diff.status")} </span>
                <span className="font-mono">{right.response.status}</span>
                <span className="ml-3 text-text-tertiary">{t("diff.time")} </span>
                <span className="font-mono">{right.response.time_ms}ms</span>
                <span className="ml-3 text-text-tertiary">{t("diff.size")} </span>
                <span className="font-mono">{right.response.size_bytes}B</span>
              </div>
            </div>

            {/* Headers diff */}
            {headerDiff &&
              (headerDiff.added.length > 0 ||
                headerDiff.removed.length > 0 ||
                headerDiff.changed.length > 0) && (
                <div className="border-b border-border-light bg-surface max-h-[160px] overflow-auto px-3 py-2 text-[11px] font-mono">
                  <div className="text-text-tertiary mb-1">{t("diff.headers")}</div>
                  {headerDiff.removed.map((h) => (
                    <div key={`r-${h.key}`} className="text-error">
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
                      <div className="text-error">
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
            <div className="flex-1 overflow-auto bg-surface font-mono text-[11px] leading-[1.5]">
              {lineDiff.length === 0 ? (
                <div className="px-3 py-4 text-text-tertiary">
                  {t("diff.identical")}
                </div>
              ) : (
                lineDiff.map((line, idx) => {
                  const bg =
                    line.op === "added"
                      ? "bg-success/10"
                      : line.op === "removed"
                      ? "bg-error/10"
                      : "";
                  const prefix =
                    line.op === "added" ? "+" : line.op === "removed" ? "-" : " ";
                  const color =
                    line.op === "added"
                      ? "text-success"
                      : line.op === "removed"
                      ? "text-error"
                      : "text-text-secondary";
                  return (
                    <div key={idx} className={`flex ${bg}`}>
                      <span className="w-10 shrink-0 px-1 text-right text-text-tertiary select-none">
                        {line.leftNo ?? ""}
                      </span>
                      <span className="w-10 shrink-0 px-1 text-right text-text-tertiary select-none">
                        {line.rightNo ?? ""}
                      </span>
                      <span className={`w-4 shrink-0 select-none ${color}`}>{prefix}</span>
                      <span className={`flex-1 whitespace-pre-wrap break-all ${color}`}>
                        {line.text}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
