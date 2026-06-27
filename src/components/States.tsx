"use client";

import { cn } from "@/lib/utils";
import { Loader2, type LucideIcon } from "lucide-react";
import { Button } from "./ui";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-16 text-center",
        className,
      )}
    >
      <div className="relative mb-4">
        <div className="absolute inset-0 -z-10 animate-pulse rounded-full bg-accent-500/20 blur-2xl" />
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-accent-600">
          <Icon className="h-6 w-6" />
        </div>
      </div>
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-sm text-sm text-slate-500">{description}</p>
      )}
      {action && (
        <Button className="mt-5" onClick={action.onClick}>
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
        "flex flex-col items-center justify-center gap-3 text-slate-400",
        full ? "min-h-screen" : "py-20",
      )}
    >
      <div className="relative">
        <div className="absolute inset-0 -z-10 animate-pulse rounded-full bg-accent-500/30 blur-xl" />
        <Loader2 className="h-7 w-7 animate-spin text-accent-400" />
      </div>
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl bg-slate-50",
        className,
      )}
    >
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-slate-200 to-transparent" />
    </div>
  );
}
