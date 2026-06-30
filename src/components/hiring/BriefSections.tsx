"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { AiEmployeeJobBrief } from "@/lib/hiring/types";

export function briefDisplay(brief?: Partial<AiEmployeeJobBrief>): Partial<AiEmployeeJobBrief> {
  return brief ?? {};
}

export function LiveBriefCursor({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[1px] animate-[briefCursorBlink_1s_step-end_infinite] bg-accent align-middle",
        className,
      )}
      aria-hidden
    />
  );
}

export function TypewriterText({
  text,
  active,
  className,
  speed = 14,
}: {
  text: string;
  active: boolean;
  className?: string;
  speed?: number;
}) {
  const [displayed, setDisplayed] = useState(text);

  useEffect(() => {
    if (!active || !text) {
      setDisplayed(text);
      return;
    }

    setDisplayed("");
    let index = 0;
    const timer = setInterval(() => {
      index += 1;
      setDisplayed(text.slice(0, index));
      if (index >= text.length) clearInterval(timer);
    }, speed);

    return () => clearInterval(timer);
  }, [text, active, speed]);

  return (
    <span className={className}>
      {displayed}
      {active && <LiveBriefCursor />}
    </span>
  );
}

export function BriefSectionBlock({
  label,
  children,
  empty,
  className,
  active = false,
  updateTag,
}: {
  label: string;
  children: React.ReactNode;
  empty?: boolean;
  className?: string;
  active?: boolean;
  updateTag?: "updating" | "updated" | null;
}) {
  const isActive = active;

  return (
    <div
      className={cn(
        "border-t border-border/70 py-4 first:border-t-0 first:pt-0 transition-colors duration-300",
        isActive && "relative -mx-2 rounded-xl bg-accent-soft/35 px-2 ring-1 ring-accent/25",
        updateTag === "updated" && "relative -mx-2 rounded-xl bg-green/10 px-2 ring-1 ring-green/25",
        className,
      )}
    >
      <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3">
        <span>{label}</span>
        {updateTag === "updating" && (
          <span className="normal-case tracking-normal text-accent animate-pulse">updating…</span>
        )}
        {updateTag === "updated" && (
          <span className="normal-case tracking-normal text-green">updated</span>
        )}
        {isActive && !updateTag && (
          <span className="flex items-center gap-1 normal-case tracking-normal text-accent">
            <LiveBriefCursor className="h-3 w-[2px]" />
            <span className="text-[10px]">editing</span>
          </span>
        )}
      </div>
      {empty ? (
        <div className="h-4 animate-pulse rounded bg-muted/80" />
      ) : (
        children
      )}
    </div>
  );
}

export function BulletList({
  items,
  placeholder,
  composing,
  composeFromIndex,
}: {
  items?: string[];
  placeholder?: string;
  composing?: boolean;
  composeFromIndex?: number;
}) {
  if (!items?.length) {
    return <p className="text-sm italic text-ink-3">{placeholder ?? "—"}</p>;
  }

  const startIndex = composeFromIndex ?? (composing ? Math.max(0, items.length - 1) : -1);

  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2.5 text-[14px] leading-relaxed text-ink">
          <span className="text-ink/25">•</span>
          <span>
            {composing && i === startIndex ? (
              <TypewriterText text={item} active />
            ) : (
              item
            )}
            {composing && i === items.length - 1 && i !== startIndex && <LiveBriefCursor />}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function MetaLine({
  label,
  value,
  composing,
}: {
  label: string;
  value?: string;
  composing?: boolean;
}) {
  if (!value) return null;
  return (
    <span className="text-[12.5px] text-ink-2">
      <span className="text-ink-3">{label}</span> ·{" "}
      {composing ? <TypewriterText text={value} active className="inline" /> : value}
    </span>
  );
}
