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
import {
  cleanChatFileTitle,
  extensionFromToolName,
  isPreviewableChatFile,
  chatFilePreviewKind,
} from "@/lib/chat/file-preview-kind";
import { useStore } from "@/lib/demo-store";
import { cn } from "@/lib/utils";
import { AlertCircle, CheckCircle2, Clock, Loader2, RefreshCw, ShieldAlert, X } from "lucide-react";
import { Button } from "@/components/ui";
import { ChatFileMiniViewer } from "@/components/chat/ChatFileMiniViewer";
import { notifyDriveUpdated } from "@/lib/drive/client";
import { VIDEO_ESTIMATE_CARD_SUMMARY } from "@/lib/brain/video/types";

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
    result?: {
      artifactId?: string;
      exportId?: string;
      title?: string;
      rowCount?: number;
    };
  };
};

function isDriveFileTool(toolName?: string): boolean {
  if (!toolName) return false;
  if (toolName.startsWith("image.") || toolName === "video.create") return true;
  if (!toolName.startsWith("artifact.")) return false;
  return (
    toolName.includes("Spreadsheet") ||
    toolName.includes("Pdf") ||
    toolName.includes("Docx") ||
    toolName.includes("Presentation") ||
    toolName.includes("convertFile") ||
    toolName.includes("saveToDrive")
  );
}

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
  const [cancelling, setCancelling] = useState(false);
  const [retryMessage, setRetryMessage] = useState<string | null>(null);
  const persistedRef = useRef(false);
  const prevStatusRef = useRef(artifact.meta?.toolStatus);
  const locallyResolvedJobRef = useRef<string | null>(null);
  const artifactRef = useRef(artifact);
  artifactRef.current = artifact;

  const status = display.meta?.toolStatus ?? "failed";
  const href = display.meta?.href;
  const isReplyRetry = display.meta?.retryKind === "employee_reply";
  const canRetryTool =
    status === "failed" &&
    !isReplyRetry &&
    display.meta?.toolName &&
    context?.workspaceId &&
    context?.employeeId &&
    display.meta?.retryArgs;
  const canRetryReply =
    status === "failed" &&
    isReplyRetry &&
    context?.workspaceId &&
    context?.employeeId &&
    context?.roomId &&
    (display.meta?.triggerMessageId ?? context?.messageId);
  const canRetry = Boolean(canRetryTool || canRetryReply);

  const persistResolvedArtifact = (resolved: MessageArtifact, resolvedJobId: string) => {
    if (persistedRef.current || !context?.roomId || !context?.messageId) return;
    if (
      resolved.meta?.toolStatus !== "success" &&
      resolved.meta?.toolStatus !== "failed" &&
      resolved.meta?.toolStatus !== "cancelled"
    ) {
      return;
    }

    const room = stateRef.current.rooms.find((r) => r.id === context.roomId);
    const message = room?.messages.find((m) => m.id === context.messageId);
    if (!message) return;

    persistedRef.current = true;
    locallyResolvedJobRef.current = resolvedJobId;
    actions.updateMessage(context.roomId, context.messageId, {
      artifacts: replaceQueuedArtifactInList(message.artifacts, resolvedJobId, resolved),
    });
    if (resolved.meta?.toolStatus === "success" && isDriveFileTool(resolved.meta?.toolName)) {
      notifyDriveUpdated();
    }
  };

  const jobId = queuedArtifactJobId(artifact) ?? artifact.meta?.jobId;
  const toolStatus = artifact.meta?.toolStatus;
  const toolName = artifact.meta?.toolName;

  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = toolStatus;

    const holdLocalResolution =
      Boolean(jobId) &&
      locallyResolvedJobRef.current === jobId &&
      toolStatus === "queued";

    if (!holdLocalResolution) {
      setDisplay(artifact);
      setChecking(toolStatus === "queued");
      if (toolStatus === "success" || toolStatus === "failed") {
        locallyResolvedJobRef.current = jobId ?? null;
        persistedRef.current = false;
      }
    }

    if (prev === "queued" && toolStatus === "success" && isDriveFileTool(toolName)) {
      notifyDriveUpdated();
    }
  }, [artifact, artifact.id, jobId, toolStatus, toolName]);

  useEffect(() => {
    if (toolStatus !== "queued" || !jobId) {
      setChecking(false);
      return;
    }

    let cancelled = false;
    let attempts = 0;

    const applyTerminal = (
      terminal: "success" | "failed" | "cancelled",
      bodyJob: NonNullable<IntegrationJobResponse["job"]>,
    ) => {
      const snapshot = artifactRef.current;
      if (terminal === "success") {
        const resolved = artifactFromCompletedJob(snapshot, {
          id: jobId,
          workspaceId: context?.workspaceId ?? "",
          jobType: toolName ?? "artifact",
          status: "success",
          payload: {},
          result: bodyJob.result ?? {},
          attempts: 0,
          maxAttempts: 3,
          scheduledAt: "",
          createdAt: "",
        });
        locallyResolvedJobRef.current = jobId;
        setDisplay(resolved);
        setChecking(false);
        persistResolvedArtifact(resolved, jobId);
        return;
      }
      if (terminal === "cancelled") {
        const resolved: MessageArtifact = {
          ...snapshot,
          label: `Cancelled: ${toolName?.split(".").pop() ?? "action"}`,
          meta: {
            ...snapshot.meta,
            toolStatus: "cancelled",
            error: bodyJob.errorMessage ?? "Cancelled.",
            subtitle: bodyJob.errorMessage ?? "Cancelled before the video finished.",
          },
        };
        locallyResolvedJobRef.current = jobId;
        setDisplay(resolved);
        setChecking(false);
        persistResolvedArtifact(resolved, jobId);
        return;
      }
      const resolved: MessageArtifact = {
        ...snapshot,
        label: `Failed: ${toolName?.split(".").pop() ?? "action"}`,
        meta: {
          ...snapshot.meta,
          toolStatus: "failed",
          error: bodyJob.errorMessage ?? "Background job failed.",
          subtitle: bodyJob.errorMessage ?? "Background job failed.",
        },
      };
      locallyResolvedJobRef.current = jobId;
      setDisplay(resolved);
      setChecking(false);
      persistResolvedArtifact(resolved, jobId);
    };

    // Video SF jobs can take several minutes — keep polling longer than sheets/images.
    const maxAttempts = toolName === "video.create" ? 300 : 45;
    const pollMs = toolName === "video.create" ? 3000 : 2000;

    const poll = async () => {
      if (cancelled || attempts > maxAttempts) {
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
            window.setTimeout(() => void poll(), attempts === 1 ? 0 : pollMs);
          }
          return;
        }
        const body = (await res.json()) as IntegrationJobResponse;
        if (!body.job) {
          if (!cancelled) setChecking(false);
          return;
        }

        // Apply terminal status even if this effect was cleaned up — otherwise
        // parent re-renders cancel in-flight polls and the chip stays forever.
        if (body.job.status === "success") {
          applyTerminal("success", body.job);
          return;
        }
        if (body.job.status === "failed") {
          applyTerminal("failed", body.job);
          return;
        }
        if (body.job.status === "cancelled") {
          applyTerminal("cancelled", body.job);
          return;
        }
      } catch {
        // keep polling
      }

      if (!cancelled) {
        if (attempts === 1) setChecking(false);
        window.setTimeout(() => void poll(), pollMs);
      }
    };

    void poll();
    return () => {
      cancelled = true;
    };
  }, [jobId, toolStatus, toolName, context?.messageId, context?.roomId, context?.workspaceId]);

  const retryToolCall = async () => {
    const headers = await authHeaders();
    const res = await fetch("/api/integrations/tools/run", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        workspaceId: context!.workspaceId,
        employeeId: context!.employeeId,
        tool: display.meta!.toolName,
        mode: "execute",
        args: display.meta!.retryArgs ?? {},
        roomId: context!.roomId,
        topicId: context!.topicId,
        triggerMessageId: display.meta!.triggerMessageId,
        idempotencyKey: display.meta!.idempotencyKey,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      result?: {
        status?: string;
        error?: string;
        output?: {
          summary?: string;
          objectId?: string;
          payload?: { exportId?: string; title?: string };
        };
      };
    };
    if (!res.ok) throw new Error(body.error ?? "Retry failed.");
    if (body.result?.status !== "success") {
      throw new Error(body.result?.error ?? `Retry ${body.result?.status ?? "failed"}.`);
    }
    const objectId = body.result.output?.objectId;
    const exportId = body.result.output?.payload?.exportId;
    const retryExt = extensionFromToolName(display.meta?.toolName);
    setDisplay({
      ...display,
      label: body.result.output?.summary ?? "Action succeeded.",
      meta: {
        ...display.meta,
        toolStatus: "success",
        href: objectId ? `/drive?artifact=${objectId}` : "/drive",
        subtitle: retryExt ? `Open in Drive · .${retryExt}` : "Open in Drive",
        exportId,
        fileExtension: retryExt,
        fileName: body.result.output?.payload?.title
          ? cleanChatFileTitle(String(body.result.output.payload.title))
          : display.meta?.fileName,
        error: undefined,
      },
    });
    setRetryMessage(body.result.output?.summary ?? "Action succeeded.");
  };

  /**
   * Regenerates the whole employee turn instead of one tool call — used when
   * nothing narrower can be retried (the model call itself failed, or it never
   * emitted a real tool call in the first place). Queues a fresh agent run via
   * the same machinery a normal incoming message uses, processes it, and drops
   * the resulting reply into the room as a new message.
   */
  const retryEmployeeReply = async () => {
    const triggerMessageId = display.meta?.triggerMessageId ?? context?.messageId;
    if (!triggerMessageId) throw new Error("Nothing to retry.");
    const headers = await authHeaders();
    const queueRes = await fetch(`/api/messages/${encodeURIComponent(triggerMessageId)}/retry-response`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ employeeId: context!.employeeId }),
    });
    const queueBody = (await queueRes.json().catch(() => ({}))) as {
      error?: string;
      queued?: { runId: string }[];
    };
    if (!queueRes.ok || !queueBody.queued?.length) {
      throw new Error(queueBody.error ?? "Could not queue a retry.");
    }

    const runId = queueBody.queued[0].runId;
    const processRes = await fetch(`/api/agent-runs/${encodeURIComponent(runId)}/process`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ workspaceId: context!.workspaceId }),
    });
    const processBody = (await processRes.json().catch(() => ({}))) as {
      error?: string;
      code?: string;
      reply?: string;
      aiMessageId?: string;
      employeeId?: string;
      employeeName?: string;
      artifacts?: MessageArtifact[];
    };

    // The room's own background poller can win the race and claim this run
    // before this explicit call does — that's not a failure, the reply is
    // already on its way in via the normal live-message flow.
    if (processRes.status === 409 && processBody.code === "already_claimed_or_not_ready") {
      setRetryMessage("Retrying — the new reply will appear in the room shortly.");
      return;
    }

    if (!processRes.ok || !processBody.aiMessageId) {
      throw new Error(processBody.error ?? "Retry failed.");
    }

    actions.addMessage(context!.roomId!, {
      id: processBody.aiMessageId,
      topicId: context?.topicId,
      senderType: "ai",
      senderId: processBody.employeeId ?? context!.employeeId!,
      senderName: processBody.employeeName ?? "",
      content: processBody.reply ?? "",
      artifacts: processBody.artifacts,
      agentRunId: runId,
      triggerMessageId,
    });
    setRetryMessage("Retried — see the new reply below.");
  };

  const retry = async () => {
    if (!canRetry) return;
    setRetrying(true);
    setRetryMessage(null);
    try {
      if (isReplyRetry) {
        await retryEmployeeReply();
      } else {
        await retryToolCall();
      }
    } catch (error) {
      setRetryMessage(error instanceof Error ? error.message : "Retry failed.");
    } finally {
      setRetrying(false);
    }
  };

  const showQueued = status === "queued" && !checking;
  const canCancelVideo =
    Boolean(jobId) &&
    display.meta?.toolName === "video.create" &&
    (status === "queued" || checking) &&
    status !== "cancelled";

  const cancelVideoJob = async () => {
    if (!jobId || cancelling) return;
    setCancelling(true);
    setRetryMessage(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/integrations/jobs/${encodeURIComponent(jobId)}/cancel`, {
        method: "POST",
        headers,
        credentials: "include",
      });
      const body = (await res.json()) as {
        error?: string;
        job?: { status?: string; errorMessage?: string; result?: Record<string, unknown> };
      };
      if (!res.ok) throw new Error(body.error ?? "Unable to cancel video.");
      if (body.job?.status === "cancelled" || body.job?.status === "failed") {
        const resolved: MessageArtifact = {
          ...display,
          label: "Cancelled: video",
          meta: {
            ...display.meta,
            toolStatus: "cancelled",
            error: body.job.errorMessage ?? "Cancelled.",
            subtitle: body.job.errorMessage ?? "Cancelled before the video finished.",
          },
        };
        locallyResolvedJobRef.current = jobId;
        setDisplay(resolved);
        setChecking(false);
        persistResolvedArtifact(resolved, jobId);
      } else {
        setRetryMessage("Cancel requested — stopping when the next status check completes.");
      }
    } catch (error) {
      setRetryMessage(error instanceof Error ? error.message : "Unable to cancel video.");
    } finally {
      setCancelling(false);
    }
  };

  const fileExtension =
    display.meta?.fileExtension ?? extensionFromToolName(display.meta?.toolName);
  const previewKind = chatFilePreviewKind({
    extension: fileExtension,
    mimeType: display.meta?.mimeType,
    toolName: display.meta?.toolName,
    fileName: display.meta?.fileName ?? display.label,
  });
  const showFileViewer =
    status === "success" &&
    !checking &&
    Boolean(context?.workspaceId) &&
    isDriveFileTool(display.meta?.toolName) &&
    isPreviewableChatFile(previewKind);

  if (showFileViewer && context?.workspaceId) {
    const artifactId = display.id;
    const exportId = display.meta?.exportId;
    const viewerTitle =
      display.meta?.fileName ??
      cleanChatFileTitle(display.label.replace(/^(Spreadsheet|Report|Document|Presentation|File) ready — /i, ""));

    // Markdown twin for in-chat preview fallback (sheets + PDFs). Never for
    // pptx — that made Drive/chat look like a .md sales deck.
    const useMarkdownTwin =
      Boolean(exportId) &&
      (previewKind === "spreadsheet" ||
        previewKind === "pdf" ||
        fileExtension === "xlsx" ||
        fileExtension === "csv" ||
        fileExtension === "pdf");

    return (
      <ChatFileMiniViewer
        workspaceId={context.workspaceId}
        title={viewerTitle}
        source={
          exportId
            ? { type: "export", id: exportId }
            : { type: "artifact", id: artifactId }
        }
        previewSource={
          useMarkdownTwin ? { type: "artifact", id: artifactId } : undefined
        }
        extension={fileExtension}
        mimeType={display.meta?.mimeType}
        toolName={display.meta?.toolName}
        driveHref={href}
      />
    );
  }

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
              : status === "cancelled"
                ? X
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
              : status === "cancelled"
                ? "border-border bg-surface text-ink-2"
                : "border-rose-200 bg-rose-50 text-rose-900";

  const queuedHint =
    display.meta?.toolName === "video.create"
      ? `Processing… ${VIDEO_ESTIMATE_CARD_SUMMARY}`
      : "Generating file — will update when ready.";

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
          {checking
            ? display.meta?.toolName === "video.create"
              ? "Checking video status…"
              : "Checking file status…"
            : display.label}
        </div>
        {display.meta?.subtitle && !checking && (
          <p className="mt-1 text-xs opacity-90">{display.meta.subtitle}</p>
        )}
        {showQueued && !display.meta?.subtitle && (
          <p className="mt-1 flex items-center gap-1 text-xs opacity-80">
            <Clock className="h-3 w-3" />
            {queuedHint}
          </p>
        )}
        {retryMessage && status !== "success" && (
          <p className="mt-1 text-xs opacity-90">{retryMessage}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {canCancelVideo && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-7 gap-1 text-xs"
              disabled={cancelling}
              onClick={() => void cancelVideoJob()}
            >
              <X className={cn("h-3 w-3", cancelling && "animate-pulse")} />
              Cancel video
            </Button>
          )}
          {canRetry && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-7 gap-1 text-xs"
              disabled={retrying}
              onClick={() => void retry()}
            >
              <RefreshCw className={cn("h-3 w-3", retrying && "animate-spin")} />
              Retry
            </Button>
          )}
        </div>
      </div>
      {href && !canRetry && !checking && status !== "queued" && status !== "cancelled" && (
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
