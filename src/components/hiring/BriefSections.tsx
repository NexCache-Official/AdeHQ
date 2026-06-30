"use client";

import { cn } from "@/lib/utils";
import type { AiEmployeeJobBrief } from "@/lib/hiring/types";

export function briefDisplay(brief?: Partial<AiEmployeeJobBrief>): Partial<AiEmployeeJobBrief> {
  return brief ?? {};
}

export function BriefSectionBlock({
  label,
  children,
  empty,
  className,
}: {
  label: string;
  children: React.ReactNode;
  empty?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("border-t border-border/70 py-4 first:border-t-0 first:pt-0", className)}>
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3">
        {label}
      </div>
      {empty ? (
        <div className="h-4 animate-pulse rounded bg-muted/80" />
      ) : (
        children
      )}
    </div>
  );
}

export function BulletList({ items, placeholder }: { items?: string[]; placeholder?: string }) {
  if (!items?.length) {
    return <p className="text-sm italic text-ink-3">{placeholder ?? "—"}</p>;
  }
  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2.5 text-[14px] leading-relaxed text-ink">
          <span className="text-ink/25">•</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function MetaLine({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <span className="text-[12.5px] text-ink-2">
      <span className="text-ink-3">{label}</span> · {value}
    </span>
  );
}
