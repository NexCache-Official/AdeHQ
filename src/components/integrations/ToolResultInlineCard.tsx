"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { MessageArtifact } from "@/lib/types";
import { authHeaders } from "@/lib/api/auth-client";
import {
  artifactFromCompletedJob,
  queuedArtifactJobId,
  replaceQueuedArtifactInList,
} from "@/lib/integrations/reconcile-queued-artifacts";
import { useStore } from "@/lib/demo-store";
import { cn } from "@/lib/utils";
import { AlertCircle, CheckCircle2, Clock, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui";

type ToolResultContext = {
  workspaceId?: string;
  employeeId?: string;
  roomId?: string;
  topicId?: string;
  messageId?: string;
};

type IntegrationJobResponse = {
  job?: {
    status?: string;
    errorMessage?: string;
    result?: { artifactId?: string; title?: string; rowCount?: number };
  };
};

export function ToolResultInlineCard({
  artifact,
  context,
}: {
  artifact: MessageArtifact;
  context?: ToolResultContext;
}) {
  const { state, actions } = useStore();
  const stateRef = useRef(state);
  stateRef.current = state;
  const [display, setDisplay] = useState<MessageArtifact>(artifact);
  const [checking, setChecking] = useState(artifact.meta?.toolStatus === "queued");
  const [retrying, setRetrying] = useState(false);
  const [retryMessage, setRetryMessage] = useState<string | null>(null);
  const persistedRef = useRef(false);

  const status = display.meta?.toolStatus ?? "failed";
  const href = display.meta?.href;
  const canRetry =
    status === "failed" &&
    display.meta?.toolName &&
    context?.workspaceId &&
    context?.employeeId &&
    display.meta?.retryArgs;

  const persistResolvedArtifact = (resolved: MessageArtifact, jobId: string) => {
    if (persistedRef.current || !context?.roomId || !context?.messageId) return;
    if (resolved.meta?.toolStatus !== "success" && resolved.meta?.toolStatus !== "failed") return;

    const room = stateRef.current.rooms.find((r) => r.id === context.roomId);
    const message = room?.messages.find((m) => m.id === context.messageId);
    if (!message) return;

    persistedRef.current = true;
    actions.updateMessage(context.roomId, context.messageId, {
      artifacts: replaceQueuedArtifactInList(message.artifacts, jobId, resolved),
    });
  };

  useEffect(() => {
    setDisplay(artifact);
    setChecking(artifact.meta?.toolStatus === "queued");
    persistedRef.current = false;
  }, [artifact]);

  useEffect(() => {
    const jobId = queuedArtifactJobId(artifact);
    if (artifact.meta?.toolStatus !== "queued" || !jobId) {
      setChecking(false);
      return;
    }

    let cancelled = false;
    let attempts = 0;

    const poll = async () => {
      if (cancelled || attempts > 30) {
        if (!cancelled) setChecking(false);
        return;
      }
      attempts += 1;
      try {
        const headers = await authHeaders();
        const res = await fetch(`/api/integrations/jobs/${encodeURIComponent(jobId)}`, {
          headers,
          credentials: "include",
        });
        if (!res.ok) {
          if (!cancelled) {
            if (attempts >= 3) setChecking(false);
            window.setTimeout(() => void poll(), attempts === 1 ? 0 : 2000);
          }
          return;
        }
        const body = (await res.json()) as IntegrationJobResponse;
        if (cancelled || !body.job) {
          if (!cancelled) setChecking(false);
          return;
        }

        if (body.job.status === "success") {
          const resolved = artifactFromCompletedJob(artifact, {
            id: jobId,
            workspaceId: context?.workspaceId ?? "",
            jobType: artifact.meta?.toolName ?? "artifact",
            status: "success",
            payload: {},
            result: body.job.result ?? {},
            attempts: 0,
            maxAttempts: 3,
            scheduledAt: "",
            createdAt: "",
          });
          setDisplay(resolved);
          setChecking(false);
          persistResolvedArtifact(resolved, jobId);
          return;
        }
        if (body.job.status === "failed") {
          const resolved: MessageArtifact = {
            ...artifact,
            label: `Failed: ${artifact.meta?.toolName?.split(".").pop() ?? "action"}`,
            meta: {
              ...artifact.meta,
              toolStatus: "failed",
              error: body.job.errorMessage ?? "Background job failed.",
              subtitle: body.job.errorMessage ?? "Background job failed.",
            },
          };
          setDisplay(resolved);
          setChecking(false);
          persistResolvedArtifact(resolved, jobId);
          return;
        }
      } catch {
        // keep polling
      }

      if (!cancelled) {
        if (attempts === 1) setChecking(false);
        window.setTimeout(() => void poll(), 2000);
      }
    };

    void poll();
    return () => {
      cancelled = true;
    };
  }, [artifact, context?.messageId, context?.roomId, context?.workspaceId, actions]);

  const retry = async () => {
    if (!canRetry || !display.meta?.toolName) return;
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
          tool: display.meta.toolName,
          mode: "execute",
          args: display.meta.retryArgs ?? {},
          roomId: context!.roomId,
          topicId: context!.topicId,
          triggerMessageId: display.meta.triggerMessageId,
          idempotencyKey: display.meta.idempotencyKey,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        result?: { status?: string; error?: string; output?: { summary?: string; objectId?: string } };
      };
      if (!res.ok) throw new Error(body.error ?? "Retry failed.");
      if (body.result?.status === "success") {
        const objectId = body.result.output?.objectId;
        setDisplay({
          ...display,
          label: body.result.output?.summary ?? "Action succeeded.",
          meta: {
            ...display.meta,
            toolStatus: "success",
            href: objectId ? `/drive?artifact=${objectId}` : "/drive",
            subtitle: "Open in Drive",
            error: undefined,
          },
        });
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

  const showQueued = status === "queued" && !checking;

  const Icon =
    checking
      ? Loader2
      : status === "success"
        ? CheckCircle2
        : status === "queued"
          ? Loader2
          : status === "approval_pending"
            ? ShieldAlert
            : status === "blocked"
              ? ShieldAlert
              : AlertCircle;
  const tone =
    checking
      ? "border-border bg-surface text-ink-2"
      : status === "success"
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
        className={cn(
          "mt-0.5 h-4 w-4 shrink-0",
          (checking || status === "queued") && "animate-spin",
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="font-medium">
          {checking ? "Checking file status…" : display.label}
        </div>
        {display.meta?.subtitle && !checking && (
          <p className="mt-1 text-xs opacity-90">{display.meta.subtitle}</p>
        )}
        {showQueued && !display.meta?.subtitle && (
          <p className="mt-1 flex items-center gap-1 text-xs opacity-80">
            <Clock className="h-3 w-3" />
            Generating file — will update when ready.
          </p>
        )}
        {retryMessage && status !== "success" && (
          <p className="mt-1 text-xs opacity-90">{retryMessage}</p>
        )}
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
      {href && !canRetry && !checking && (
        <span className="shrink-0 text-xs font-medium opacity-80">Open →</span>
      )}
    </>
  );

  const className = cn(
    "mt-2 flex items-start gap-3 rounded-xl border px-3.5 py-3 text-sm shadow-sm transition",
    tone,
    href && !canRetry && !checking && "hover:brightness-[0.98]",
  );

  if (href && !canRetry && !checking) {
    return (
      <Link href={href} className={className}>
        {body}
      </Link>
    );
  }

  return <div className={className}>{body}</div>;
}
