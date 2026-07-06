"use client";

import type { MessageArtifact } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AlertCircle, Clock, Loader2, ShieldAlert } from "lucide-react";

export function ToolResultInlineCard({ artifact }: { artifact: MessageArtifact }) {
  const status = artifact.meta?.toolStatus ?? "failed";
  const Icon =
    status === "queued" ? Loader2 : status === "blocked" ? ShieldAlert : AlertCircle;
  const tone =
    status === "queued"
      ? "border-sky-200 bg-sky-50 text-sky-900"
      : status === "blocked"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : "border-rose-200 bg-rose-50 text-rose-900";

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border px-3.5 py-3 text-sm shadow-sm",
        tone,
      )}
    >
      <Icon
        className={cn("mt-0.5 h-4 w-4 shrink-0", status === "queued" && "animate-spin")}
      />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{artifact.label}</div>
        {artifact.meta?.subtitle && (
          <p className="mt-1 text-xs opacity-90">{artifact.meta.subtitle}</p>
        )}
        {status === "queued" && (
          <p className="mt-1 flex items-center gap-1 text-xs opacity-80">
            <Clock className="h-3 w-3" />
            Background job — check Work Log when complete.
          </p>
        )}
      </div>
    </div>
  );
}
