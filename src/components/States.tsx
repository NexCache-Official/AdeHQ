"use client";

import { cn } from "@/lib/utils";
import { Loader2, type LucideIcon } from "lucide-react";
import { BrandMark } from "@/components/brand/Brand";
import { Button } from "./ui";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  eyebrow,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  className?: string;
  /** Optional mono status chip (404 / auth language). */
  eyebrow?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center overflow-hidden rounded-2xl border border-dashed border-border bg-surface px-6 py-16 text-center animate-[lgFadeUp_0.45s_cubic-bezier(0.2,0.7,0.3,1)_both]",
        className,
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -left-16 -top-20 h-48 w-48 rounded-full bg-[radial-gradient(circle,rgb(var(--c-accent)/0.14),transparent_68%)] blur-2xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-20 -right-12 h-44 w-44 rounded-full bg-[radial-gradient(circle,rgb(var(--c-accent-2)/0.1),transparent_70%)] blur-2xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.3]"
        style={{
          backgroundImage: "radial-gradient(rgb(var(--c-ink) / 0.05) 1px, transparent 1px)",
          backgroundSize: "18px 18px",
        }}
      />

      {eyebrow && (
        <div className="relative mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-surface/90 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 shadow-sm">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
          {eyebrow}
        </div>
      )}

      <div className="relative mb-4">
        <div className="absolute inset-0 -z-10 rounded-full bg-accent/15 blur-2xl" />
        <div className="obd-float flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-surface text-accent shadow-[0_12px_28px_-14px_rgba(47,111,237,0.45)]">
          <Icon className="h-6 w-6" strokeWidth={1.75} />
        </div>
      </div>
      <h3 className="relative text-base font-semibold text-ink">
        {title}
        {!/[.?…!]$/.test(title) && <span className="text-accent">.</span>}
      </h3>
      {description && (
        <p className="relative mt-1.5 max-w-sm text-sm text-ink-3">{description}</p>
      )}
      {action && (
        <Button className="relative mt-5" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

export function LoadingState({
  label = "Loading workspace…",
  full = false,
}: {
  label?: string;
  full?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center gap-3 overflow-hidden text-ink-2",
        full ? "min-h-screen bg-canvas" : "py-20",
      )}
    >
      {full && (
        <>
          <div
            aria-hidden
            className="pointer-events-none absolute -left-24 -top-32 h-72 w-72 rounded-full bg-[radial-gradient(circle,rgb(var(--c-accent)/0.18),transparent_68%)] blur-3xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-28 -right-20 h-80 w-80 rounded-full bg-[radial-gradient(circle,rgb(var(--c-accent-2)/0.12),transparent_70%)] blur-3xl"
          />
        </>
      )}
      <div className="relative flex flex-col items-center gap-3 animate-[lgFadeUp_0.4s_cubic-bezier(0.2,0.7,0.3,1)_both]">
        {full ? (
          <div className="relative mb-1">
            <span className="absolute inset-0 animate-ping rounded-[20px] bg-accent/15" />
            <div className="relative flex h-16 w-16 items-center justify-center rounded-[20px] bg-surface shadow-[0_18px_40px_-18px_rgba(47,111,237,0.55)] ring-1 ring-border">
              <BrandMark size={32} nativeColor />
            </div>
          </div>
        ) : (
          <div className="relative">
            <div className="absolute inset-0 -z-10 animate-pulse rounded-full bg-accent/25 blur-xl" />
            <Loader2 className="h-7 w-7 animate-spin text-accent" />
          </div>
        )}
        <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3">
          {!full && <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />}
          {label}
        </span>
      </div>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl bg-muted",
        className,
      )}
    >
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-[var(--border)] to-transparent" />
    </div>
  );
}
