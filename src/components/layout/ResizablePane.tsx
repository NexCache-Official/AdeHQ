"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, PanelLeftClose, PanelRightClose } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  clamp,
  readPanePrefs,
  writePanePrefs,
  type PaneLimits,
} from "@/lib/layout/pane-prefs";

type ResizablePaneProps = {
  id: string;
  side: "left" | "right";
  limits: PaneLimits;
  /** Extra classes on the outer pane (visibility breakpoints, borders, etc.). */
  className?: string;
  /** When true, width is `w-full` below `md` and the CSS var width applies from `md` up. */
  fluidBelowMd?: boolean;
  /** When true, width is `w-full` below `lg` and the CSS var width applies from `lg` up. */
  fluidBelowLg?: boolean;
  collapsible?: boolean;
  collapsedLabel?: string;
  children: ReactNode;
};

/**
 * Horizontally resizable side pane with optional collapse.
 * Persists width + collapsed state in localStorage. Main work columns should
 * stay as `flex-1` siblings and never use this with collapsible=false omitted
 * only when they must remain open — pass collapsible={false} (default) for
 * non-collapsible side chrome if needed; shell side panes use collapsible.
 */
export function ResizablePane({
  id,
  side,
  limits,
  className,
  fluidBelowMd = false,
  fluidBelowLg = false,
  collapsible = true,
  collapsedLabel = "Show panel",
  children,
}: ResizablePaneProps) {
  const reactId = useId();
  const [prefs, setPrefs] = useState(() =>
    typeof window === "undefined"
      ? { width: limits.defaultWidth, collapsed: false }
      : readPanePrefs(id, limits),
  );
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(limits.defaultWidth);
  const liveWidth = useRef(prefs.width);

  useEffect(() => {
    const next = readPanePrefs(id, limits);
    setPrefs(next);
    liveWidth.current = next.width;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate once per pane id
  }, [id]);

  const persist = useCallback(
    (next: { width: number; collapsed: boolean }) => {
      liveWidth.current = next.width;
      setPrefs(next);
      writePanePrefs(id, next);
    },
    [id],
  );

  const collapsedWidth = limits.collapsedWidth ?? 44;
  const activeWidth = prefs.collapsed ? collapsedWidth : prefs.width;

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (prefs.collapsed) return;
    event.preventDefault();
    dragging.current = true;
    startX.current = event.clientX;
    startWidth.current = prefs.width;
    liveWidth.current = prefs.width;
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const delta =
      side === "left" ? event.clientX - startX.current : startX.current - event.clientX;
    const next = clamp(startWidth.current + delta, limits.minWidth, limits.maxWidth);
    liveWidth.current = next;
    setPrefs((prev) => ({ ...prev, width: next }));
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    writePanePrefs(id, { width: liveWidth.current, collapsed: false });
  };

  const resetWidth = () => {
    persist({ width: limits.defaultWidth, collapsed: false });
  };

  const toggleCollapsed = () => {
    persist({ width: prefs.width, collapsed: !prefs.collapsed });
  };

  const CollapseIcon = side === "left" ? PanelLeftClose : PanelRightClose;
  const ExpandIcon = side === "left" ? ChevronRight : ChevronLeft;

  return (
    <div
      className={cn(
        "group/pane relative flex h-full min-h-0 shrink-0 flex-col",
        fluidBelowMd &&
          (prefs.collapsed
            ? "hidden md:flex md:w-[var(--pane-w)]"
            : "w-full md:w-[var(--pane-w)]"),
        fluidBelowLg &&
          (prefs.collapsed
            ? "hidden lg:flex lg:w-[var(--pane-w)]"
            : "w-full lg:w-[var(--pane-w)]"),
        !fluidBelowMd && !fluidBelowLg && "w-[var(--pane-w)]",
        className,
      )}
      style={{ ["--pane-w" as string]: `${activeWidth}px` }}
      data-pane-id={id}
      data-pane-collapsed={prefs.collapsed ? "true" : "false"}
    >
      {prefs.collapsed ? (
        <button
          type="button"
          onClick={toggleCollapsed}
          className={cn(
            "flex h-full w-full flex-col items-center gap-2 border-border bg-surface/80 py-3 text-ink-3 transition-colors hover:bg-muted hover:text-ink",
            side === "left" ? "border-r" : "border-l",
          )}
          aria-label={collapsedLabel}
          title={collapsedLabel}
        >
          <ExpandIcon className="h-4 w-4" strokeWidth={1.9} />
          <span
            className="max-h-[40vh] truncate text-[10px] font-semibold uppercase tracking-[0.14em]"
            style={{ writingMode: "vertical-rl" }}
          >
            {collapsedLabel}
          </span>
        </button>
      ) : (
        <div
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
            collapsible && (side === "left" ? "md:pr-7" : "md:pl-7"),
          )}
        >
          {children}
        </div>
      )}

      {!prefs.collapsed && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-controls={reactId}
          aria-valuenow={Math.round(prefs.width)}
          aria-valuemin={limits.minWidth}
          aria-valuemax={limits.maxWidth}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={resetWidth}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
              e.preventDefault();
              const dir =
                (e.key === "ArrowRight" ? 1 : -1) * (side === "left" ? 1 : -1);
              const next = clamp(prefs.width + dir * 12, limits.minWidth, limits.maxWidth);
              persist({ width: next, collapsed: false });
            }
          }}
          className={cn(
            "absolute top-0 z-30 hidden h-full w-3 cursor-col-resize touch-none md:block",
            "before:absolute before:inset-y-0 before:w-px before:bg-transparent before:transition-colors",
            "hover:before:bg-accent/40 active:before:bg-accent/60",
            side === "left"
              ? "right-0 translate-x-1/2 before:left-1/2 before:-translate-x-1/2"
              : "left-0 -translate-x-1/2 before:left-1/2 before:-translate-x-1/2",
          )}
          title="Drag to resize · double-click to reset"
        />
      )}

      {collapsible && !prefs.collapsed && (
        <button
          type="button"
          onClick={toggleCollapsed}
          className={cn(
            "absolute top-2 z-40 hidden h-6 w-6 items-center justify-center rounded-md border border-border/80 bg-surface/95 text-ink-3 opacity-0 shadow-sm transition",
            "hover:border-accent/30 hover:text-ink group-hover/pane:opacity-100 focus-visible:opacity-100 md:flex",
            side === "left" ? "right-1.5" : "left-1.5",
          )}
          aria-label={`Collapse ${collapsedLabel}`}
          title="Collapse panel"
        >
          <CollapseIcon className="h-3.5 w-3.5" strokeWidth={1.9} />
        </button>
      )}
    </div>
  );
}
