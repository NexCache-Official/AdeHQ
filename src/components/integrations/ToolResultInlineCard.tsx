"use client";

import Link from "next/link";
import type { MessageArtifact } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AlertCircle, CheckCircle2, Clock, Loader2, ShieldAlert } from "lucide-react";

export function ToolResultInlineCard({ artifact }: { artifact: MessageArtifact }) {
  const status = artifact.meta?.toolStatus ?? "failed";
  const href = artifact.meta?.href;
  const Icon =
    status === "success"
      ? CheckCircle2
      : status === "queued"
        ? Loader2
        : status === "approval_pending"
          ? ShieldAlert
          : status === "blocked"
            ? ShieldAlert
            : AlertCircle;
  const tone =
    status === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-950"
      : status === "queued"
        ? "border-sky-200 bg-sky-50 text-sky-900"
        : status === "approval_pending"
          ? "border-amber-200 bg-amber-50 text-amber-950"
          : status === "blocked"
            ? "border-amber-200 bg-amber-50 text-amber-900"
            : "border-rose-200 bg-rose-50 text-rose-900";

  const body = (
    <>
      <Icon
        className={cn("mt-0.5 h-4 w-4 shrink-0", status === "queued" && "animate-spin")}
      />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{artifact.label}</div>
        {artifact.meta?.subtitle && (
          <p className="mt-1 text-xs opacity-90">{artifact.meta.subtitle}</p>
        )}
        {status === "queued" && !artifact.meta?.subtitle && (
          <p className="mt-1 flex items-center gap-1 text-xs opacity-80">
            <Clock className="h-3 w-3" />
            Background job — check Work Log when complete.
          </p>
        )}
      </div>
      {href && (
        <span className="shrink-0 text-xs font-medium opacity-80">Open →</span>
      )}
    </>
  );

  const className = cn(
    "mt-2 flex items-start gap-3 rounded-xl border px-3.5 py-3 text-sm shadow-sm transition",
    tone,
    href && "hover:brightness-[0.98]",
  );

  if (href) {
    return (
      <Link href={href} className={className}>
        {body}
      </Link>
    );
  }

  return <div className={className}>{body}</div>;
}
