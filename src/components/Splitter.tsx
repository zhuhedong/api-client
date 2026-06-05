import { useCallback, useEffect, useRef, useState } from "react";

interface SplitterProps {
  /** "vertical" = horizontal drag handle between top/bottom panes;
   *  "horizontal" = vertical handle between left/right panes. */
  orientation: "horizontal" | "vertical";
  /** Initial size in the orientation's primary axis (px for "horizontal",
   *  percentage 0-100 for "vertical"). */
  initial: number;
  /** Inclusive clamp range. */
  min: number;
  max: number;
  /** Called continuously while dragging with the new value. */
  onChange: (value: number) => void;
  /** Called once on mouseup so callers can persist. */
  onCommit?: (value: number) => void;
}

/** A 1-line drag handle. Pure presentation — the parent owns the layout
 *  numbers; we just emit deltas. */
export function Splitter({
  orientation,
  initial,
  min,
  max,
  onChange,
  onCommit,
}: SplitterProps) {
  const [dragging, setDragging] = useState(false);
  const startRef = useRef<{ pos: number; value: number } | null>(null);
  const valueRef = useRef(initial);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const pos = orientation === "horizontal" ? e.clientX : e.clientY;
      startRef.current = { pos, value: valueRef.current };
      setDragging(true);
    },
    [orientation],
  );

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      if (!startRef.current) return;
      const cur = orientation === "horizontal" ? e.clientX : e.clientY;
      const delta = cur - startRef.current.pos;
      let next: number;
      if (orientation === "horizontal") {
        next = startRef.current.value + delta;
      } else {
        // percentage delta from pixel delta — use viewport height
        const containerHeight = window.innerHeight;
        next = startRef.current.value + (delta / containerHeight) * 100;
      }
      next = Math.max(min, Math.min(max, next));
      valueRef.current = next;
      onChange(next);
    };
    const onUp = () => {
      setDragging(false);
      startRef.current = null;
      onCommit?.(valueRef.current);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging, orientation, min, max, onChange, onCommit]);

  // Keep ref in sync with prop when not dragging (e.g. workspace switch).
  useEffect(() => {
    if (!dragging) valueRef.current = initial;
  }, [initial, dragging]);

  const baseClass =
    orientation === "horizontal"
      ? "w-1 cursor-col-resize hover:bg-primary/40"
      : "h-1 cursor-row-resize hover:bg-primary/40";
  const activeClass = dragging ? "bg-primary/60" : "bg-transparent";

  return (
    <div
      role="separator"
      aria-orientation={orientation === "horizontal" ? "vertical" : "horizontal"}
      onMouseDown={onMouseDown}
      className={`${baseClass} ${activeClass} shrink-0 transition-colors`}
    />
  );
}
