import { useEffect, useRef } from "react";

export interface ContextMenuItem {
  label: string;
  onSelect: () => void;
  destructive?: boolean;
}

interface Props {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

/**
 * Dependency-free right-click menu: a fixed-positioned popover at the cursor
 * that closes on outside-click, Escape, scroll, or window blur. The project
 * ships `@radix-ui/react-dropdown-menu` but Radix anchors to a trigger element,
 * not arbitrary coordinates, so a small custom surface is simpler here. Styling
 * mirrors `DropdownMenuContent` (popover tokens, rounded, shadow).
 */
export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // Capture phase so we close before the click reaches anything underneath.
    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", onPointerDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  // Nudge the menu back on-screen if it would overflow the viewport.
  const estHeight = items.length * 32 + 8;
  const style: React.CSSProperties = {
    left: Math.min(x, window.innerWidth - 180),
    top: Math.min(y, Math.max(8, window.innerHeight - estHeight)),
  };

  return (
    <div
      ref={ref}
      role="menu"
      style={style}
      className="fixed z-[60] min-w-[160px] rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
    >
      {items.map((item, i) => (
        <button
          key={i}
          type="button"
          role="menuitem"
          onClick={() => {
            item.onSelect();
            onClose();
          }}
          className={`flex w-full items-center rounded-sm px-2 py-1.5 text-left text-[12px] transition-colors hover:bg-accent ${
            item.destructive
              ? "text-destructive hover:bg-destructive/10"
              : ""
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
