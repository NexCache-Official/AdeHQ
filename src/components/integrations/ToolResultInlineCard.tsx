"use client";

import { useState } from "react";
import Link from "next/link";
import type { MessageArtifact } from "@/lib/types";
import { authHeaders } from "@/lib/api/auth-client";
import { cn } from "@/lib/utils";
import { AlertCircle, CheckCircle2, Clock, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui";

type ToolResultContext = {
  workspaceId?: string;
  employeeId?: string;
  roomId?: string;
  topicId?: string;
};

export function ToolResultInlineCard({
  artifact,
  context,
}: {
  artifact: MessageArtifact;
  context?: ToolResultContext;
}) {
  const [retrying, setRetrying] = useState(false);
  const [retryMessage, setRetryMessage] = useState<string | null>(null);

  const status = artifact.meta?.toolStatus ?? "failed";
  const href = artifact.meta?.href;
  const canRetry =
    status === "failed" &&
    artifact.meta?.toolName &&
    context?.workspaceId &&
    context?.employeeId &&
    artifact.meta?.retryArgs;

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

  const retry = async () => {
    if (!canRetry || !artifact.meta?.toolName) return;
    setRetrying(true);
    setRetryMessage(null);
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/integrations/tools/run", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          workspaceId: context!.workspaceId,
          employeeId: context!.employeeId,
          tool: artifact.meta.toolName,
          mode: "execute",
          args: artifact.meta.retryArgs ?? {},
          roomId: context!.roomId,
          topicId: context!.topicId,
          triggerMessageId: artifact.meta.triggerMessageId,
          idempotencyKey: artifact.meta.idempotencyKey,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        result?: { status?: string; error?: string; output?: { summary?: string } };
      };
      if (!res.ok) throw new Error(body.error ?? "Retry failed.");
      if (body.result?.status === "success") {
        setRetryMessage(body.result.output?.summary ?? "Action succeeded.");
      } else {
        throw new Error(body.result?.error ?? `Retry ${body.result?.status ?? "failed"}.`);
      }
    } catch (error) {
      setRetryMessage(error instanceof Error ? error.message : "Retry failed.");
    } finally {
      setRetrying(false);
    }
  };

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
        {retryMessage && <p className="mt-1 text-xs opacity-90">{retryMessage}</p>}
        {canRetry && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="mt-2 h-7 gap-1 text-xs"
            disabled={retrying}
            onClick={() => void retry()}
          >
            <RefreshCw className={cn("h-3 w-3", retrying && "animate-spin")} />
            Retry
          </Button>
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
    href && !canRetry && "hover:brightness-[0.98]",
  );

  if (href && !canRetry) {
    return (
      <Link href={href} className={className}>
        {body}
      </Link>
    );
  }

  return <div className={className}>{body}</div>;
}
