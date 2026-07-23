"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Maximize2, Minimize2, Minus, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Bounds = { left: number; top: number; width: number; height: number };
type Rect = { x: number; y: number; w: number; h: number };
type Edge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const MIN_W = 380;
const MIN_H = 300;
const DEFAULT_W = 640;
const DEFAULT_H = 520;
const INSET = 10;
const STORAGE_KEY = "adehq.inbox.composerWindow.v1";

type Persist = {
  rect: Rect;
  maximized: boolean;
};

function readPersist(): Persist | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Persist;
    if (
      !parsed?.rect ||
      typeof parsed.rect.x !== "number" ||
      typeof parsed.rect.y !== "number" ||
      typeof parsed.rect.w !== "number" ||
      typeof parsed.rect.h !== "number"
    ) {
      return null;
    }
    return { rect: parsed.rect, maximized: Boolean(parsed.maximized) };
  } catch {
    return null;
  }
}

function writePersist(next: Persist) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota / private mode */
  }
}

function clampRect(rect: Rect, bounds: Bounds): Rect {
  const w = Math.min(Math.max(rect.w, MIN_W), Math.max(MIN_W, bounds.width - INSET * 2));
  const h = Math.min(Math.max(rect.h, MIN_H), Math.max(MIN_H, bounds.height - INSET * 2));
  const minX = bounds.left + INSET;
  const minY = bounds.top + INSET;
  const maxX = bounds.left + bounds.width - w - INSET;
  const maxY = bounds.top + bounds.height - h - INSET;
  return {
    x: Math.min(Math.max(rect.x, minX), Math.max(minX, maxX)),
    y: Math.min(Math.max(rect.y, minY), Math.max(minY, maxY)),
    w,
    h,
  };
}

function defaultRect(bounds: Bounds): Rect {
  const w = Math.min(DEFAULT_W, Math.max(MIN_W, bounds.width - INSET * 2));
  const h = Math.min(DEFAULT_H, Math.max(MIN_H, bounds.height - INSET * 2));
  return clampRect(
    {
      x: bounds.left + bounds.width - w - 20,
      y: bounds.top + bounds.height - h - 20,
      w,
      h,
    },
    bounds,
  );
}

function maximizedRect(bounds: Bounds): Rect {
  return {
    x: bounds.left + INSET,
    y: bounds.top + INSET,
    w: Math.max(MIN_W, bounds.width - INSET * 2),
    h: Math.max(MIN_H, bounds.height - INSET * 2),
  };
}

function measureBounds(el: HTMLElement | null): Bounds | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 40 || r.height < 40) return null;
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

export function ComposerWindow({
  title,
  status,
  onClose,
  children,
  boundsRef,
}: {
  title: string;
  status?: string;
  onClose: () => void;
  children: ReactNode;
  /** Element that defines the movable area (inbox root). Falls back to viewport. */
  boundsRef: React.RefObject<HTMLElement | null>;
}) {
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [maximized, setMaximized] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [dragging, setDragging] = useState(false);
  const restoreRectRef = useRef<Rect | null>(null);
  const interactionRef = useRef<{
    kind: "drag" | "resize";
    edge?: Edge;
    startX: number;
    startY: number;
    origin: Rect;
    pointerId: number;
  } | null>(null);

  const refreshBounds = useCallback(() => {
    const next =
      measureBounds(boundsRef.current) ??
      ({
        left: 0,
        top: 0,
        width: window.innerWidth,
        height: window.innerHeight,
      } satisfies Bounds);
    setBounds(next);
    return next;
  }, [boundsRef]);

  useLayoutEffect(() => {
    const b = refreshBounds();
    const persisted = readPersist();
    const isNarrow = b.width < 720;
    if (persisted) {
      const clamped = clampRect(persisted.rect, b);
      restoreRectRef.current = clamped;
      setRect(persisted.maximized || isNarrow ? maximizedRect(b) : clamped);
      setMaximized(persisted.maximized || isNarrow);
    } else {
      const base = defaultRect(b);
      restoreRectRef.current = base;
      setRect(isNarrow ? maximizedRect(b) : base);
      setMaximized(isNarrow);
    }
  }, [refreshBounds]);

  useEffect(() => {
    const onResize = () => {
      const b = refreshBounds();
      setRect((prev) => {
        if (!prev) return prev;
        if (maximized) return maximizedRect(b);
        return clampRect(prev, b);
      });
      if (restoreRectRef.current) {
        restoreRectRef.current = clampRect(restoreRectRef.current, b);
      }
    };
    window.addEventListener("resize", onResize);
    const el = boundsRef.current;
    const ro = el ? new ResizeObserver(onResize) : null;
    if (el && ro) ro.observe(el);
    return () => {
      window.removeEventListener("resize", onResize);
      ro?.disconnect();
    };
  }, [boundsRef, maximized, refreshBounds]);

  useEffect(() => {
    if (!rect || minimized) return;
    writePersist({
      rect: restoreRectRef.current ?? rect,
      maximized,
    });
  }, [rect, maximized, minimized]);

  const endInteraction = useCallback(() => {
    interactionRef.current = null;
    setDragging(false);
  }, []);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const ix = interactionRef.current;
      const b = bounds;
      if (!ix || !b) return;
      const dx = e.clientX - ix.startX;
      const dy = e.clientY - ix.startY;

      if (ix.kind === "drag") {
        setRect(
          clampRect(
            {
              ...ix.origin,
              x: ix.origin.x + dx,
              y: ix.origin.y + dy,
            },
            b,
          ),
        );
        return;
      }

      let { x, y, w, h } = ix.origin;
      const edge = ix.edge ?? "se";
      if (edge.includes("e")) w = ix.origin.w + dx;
      if (edge.includes("s")) h = ix.origin.h + dy;
      if (edge.includes("w")) {
        w = ix.origin.w - dx;
        x = ix.origin.x + dx;
      }
      if (edge.includes("n")) {
        h = ix.origin.h - dy;
        y = ix.origin.y + dy;
      }
      // Anchor opposite edges when clamping width/height
      const next = clampRect({ x, y, w, h }, b);
      if (edge.includes("w") && next.w !== w) {
        next.x = ix.origin.x + ix.origin.w - next.w;
      }
      if (edge.includes("n") && next.h !== h) {
        next.y = ix.origin.y + ix.origin.h - next.h;
      }
      setRect(clampRect(next, b));
    };

    const onUp = () => endInteraction();
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [bounds, endInteraction]);

  const beginDrag = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("[data-window-control]")) return;
    if (!rect || !bounds) return;

    if (maximized) {
      // Dragging out of maximize restores the floating size under the cursor
      const base = restoreRectRef.current ?? defaultRect(bounds);
      const next = clampRect(
        {
          ...base,
          x: e.clientX - base.w / 2,
          y: e.clientY - 18,
        },
        bounds,
      );
      setMaximized(false);
      setRect(next);
      restoreRectRef.current = next;
      interactionRef.current = {
        kind: "drag",
        startX: e.clientX,
        startY: e.clientY,
        origin: next,
        pointerId: e.pointerId,
      };
      setDragging(true);
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    interactionRef.current = {
      kind: "drag",
      startX: e.clientX,
      startY: e.clientY,
      origin: rect,
      pointerId: e.pointerId,
    };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const beginResize = (edge: Edge) => (e: ReactPointerEvent) => {
    if (e.button !== 0 || maximized || minimized || !rect) return;
    e.preventDefault();
    e.stopPropagation();
    interactionRef.current = {
      kind: "resize",
      edge,
      startX: e.clientX,
      startY: e.clientY,
      origin: rect,
      pointerId: e.pointerId,
    };
    setDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const toggleMaximize = () => {
    if (!bounds || !rect) return;
    if (maximized) {
      const restored = clampRect(restoreRectRef.current ?? defaultRect(bounds), bounds);
      setRect(restored);
      setMaximized(false);
    } else {
      restoreRectRef.current = rect;
      setRect(maximizedRect(bounds));
      setMaximized(true);
    }
    setMinimized(false);
  };

  const minimize = () => {
    if (rect && !maximized) restoreRectRef.current = rect;
    setMinimized(true);
  };

  const restoreFromDock = () => {
    setMinimized(false);
  };

  if (!rect || !bounds) return null;

  const resizeHandles: { edge: Edge; className: string }[] = [
    { edge: "n", className: "left-3 right-3 top-0 h-1.5 cursor-ns-resize" },
    { edge: "s", className: "left-3 right-3 bottom-0 h-1.5 cursor-ns-resize" },
    { edge: "e", className: "top-3 bottom-3 right-0 w-1.5 cursor-ew-resize" },
    { edge: "w", className: "top-3 bottom-3 left-0 w-1.5 cursor-ew-resize" },
    { edge: "ne", className: "right-0 top-0 h-3 w-3 cursor-nesw-resize" },
    { edge: "nw", className: "left-0 top-0 h-3 w-3 cursor-nwse-resize" },
    { edge: "se", className: "bottom-0 right-0 h-3.5 w-3.5 cursor-nwse-resize" },
    { edge: "sw", className: "bottom-0 left-0 h-3 w-3 cursor-nesw-resize" },
  ];

  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      {minimized && (
        <button
          type="button"
          onClick={restoreFromDock}
          className="pointer-events-auto absolute bottom-4 right-4 z-10 flex max-w-[min(360px,calc(100%-2rem))] items-center gap-3 rounded-xl border border-border bg-surface px-3.5 py-2.5 text-left shadow-[0_8px_28px_rgba(36,30,26,0.16)] transition hover:border-ink-3 animate-[composeUp_0.22s_ease]"
          title="Restore composer"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink text-white">
            <Minimize2 className="h-3.5 w-3.5" strokeWidth={2.2} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold tracking-[-0.01em] text-ink">
              {title}
            </span>
            <span className="block truncate font-mono text-[11px] text-ink-3">
              {status?.trim() ? status : "Minimized · click to restore"}
            </span>
          </span>
          <span
            data-window-control
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onClose();
              }
            }}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-3 hover:bg-muted hover:text-ink"
            aria-label="Close composer"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2.2} />
          </span>
        </button>
      )}

      <div
        role="dialog"
        aria-label={title}
        aria-hidden={minimized}
        className={cn(
          "pointer-events-auto absolute flex flex-col overflow-hidden border border-border bg-surface",
          maximized
            ? "rounded-xl shadow-[0_12px_48px_rgba(36,30,26,0.18)]"
            : "rounded-2xl shadow-[0_16px_48px_rgba(36,30,26,0.2)]",
          dragging ? "select-none" : "animate-[composeUp_0.24s_ease]",
          minimized && "invisible pointer-events-none",
        )}
        style={{
          left: rect.x - bounds.left,
          top: rect.y - bounds.top,
          width: rect.w,
          height: rect.h,
        }}
      >
        <div
          onPointerDown={beginDrag}
          onDoubleClick={(e) => {
            if ((e.target as HTMLElement).closest("[data-window-control]")) return;
            toggleMaximize();
          }}
          className={cn(
            "flex h-11 shrink-0 items-center gap-2 border-b border-border px-3",
            maximized ? "cursor-default" : "cursor-grab active:cursor-grabbing",
          )}
        >
          <div className="flex w-10 shrink-0 items-center justify-center gap-[3px]" aria-hidden>
            <span className="h-1 w-1 rounded-full bg-ink-3/70" />
            <span className="h-1 w-1 rounded-full bg-ink-3/70" />
            <span className="h-1 w-1 rounded-full bg-ink-3/70" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-semibold tracking-[-0.01em] text-ink">{title}</p>
            {status ? (
              <p className="truncate font-mono text-[11px] text-green">{status}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              data-window-control
              onClick={minimize}
              className="flex h-7 w-7 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-muted hover:text-ink"
              aria-label="Minimize composer"
              title="Minimize"
            >
              <Minus className="h-3.5 w-3.5" strokeWidth={2.2} />
            </button>
            <button
              type="button"
              data-window-control
              onClick={toggleMaximize}
              className="flex h-7 w-7 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-muted hover:text-ink"
              aria-label={maximized ? "Restore composer size" : "Maximize composer"}
              title={maximized ? "Restore" : "Maximize"}
            >
              {maximized ? (
                <Minimize2 className="h-3.5 w-3.5" strokeWidth={2.2} />
              ) : (
                <Maximize2 className="h-3.5 w-3.5" strokeWidth={2.2} />
              )}
            </button>
            <button
              type="button"
              data-window-control
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-danger/10 hover:text-danger"
              aria-label="Close composer"
              title="Close"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2.2} />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>

        {!maximized &&
          resizeHandles.map(({ edge, className }) => (
            <div
              key={edge}
              onPointerDown={beginResize(edge)}
              className={cn("absolute z-10 touch-none", className)}
              aria-hidden
            />
          ))}
      </div>
    </div>
  );
}
