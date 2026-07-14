import type { MessageArtifact, RoomMessage } from "@/lib/types";
import {
  cleanChatFileTitle,
  extensionFromToolName,
} from "@/lib/chat/file-preview-kind";
import type { IntegrationJobRecord } from "./types";

/** Job id stored on a queued inline tool chip, or the chip id for artifact.* tools. */
export function queuedArtifactJobId(artifact: MessageArtifact): string | undefined {
  if (artifact.type !== "tool_result") return undefined;
  if (artifact.meta?.toolStatus !== "queued") return undefined;
  return (
    artifact.meta?.jobId ??
    (artifact.meta?.toolName?.startsWith("artifact.") ? artifact.id : undefined)
  );
}

function artifactKindFromTool(tool: string | undefined): string {
  if (!tool) return "File";
  if (tool.includes("Spreadsheet") || tool.includes("spreadsheet")) return "Spreadsheet";
  if (tool.includes("Pdf") || tool.includes("pdf")) return "Report";
  if (tool.includes("Docx") || tool.includes("docx")) return "Document";
  if (tool.includes("Presentation") || tool.includes("presentation")) return "Presentation";
  return "File";
}

function subtitleForExtension(extension: string | undefined): string {
  if (!extension) return "Open in Drive";
  return `Open in Drive · .${extension}`;
}

/** Resolved success chip after a background artifact job finishes. */
export function artifactFromCompletedJob(
  prior: MessageArtifact,
  job: IntegrationJobRecord,
): MessageArtifact {
  const payload = job.result ?? {};
  const artifactId = payload.artifactId ? String(payload.artifactId) : undefined;
  const exportId = payload.exportId ? String(payload.exportId) : undefined;
  const title = cleanChatFileTitle(payload.title ? String(payload.title) : "file");
  const kind = artifactKindFromTool(prior.meta?.toolName);
  const fileExtension =
    prior.meta?.fileExtension ?? extensionFromToolName(prior.meta?.toolName);

  return {
    type: "tool_result",
    id: artifactId ?? prior.id,
    label: `${kind} ready — ${title}`,
    meta: {
      toolName: prior.meta?.toolName,
      toolStatus: "success",
      href: artifactId
        ? `/drive?artifact=${encodeURIComponent(artifactId)}`
        : "/drive?section=exports",
      subtitle: subtitleForExtension(fileExtension),
      exportId,
      fileExtension,
      fileName: title,
    },
  };
}

export function reconcileQueuedArtifact(
  artifact: MessageArtifact,
  job: IntegrationJobRecord | null | undefined,
): MessageArtifact {
  const jobId = queuedArtifactJobId(artifact);
  if (!jobId || !job) return artifact;

  if (job.status === "success") {
    return artifactFromCompletedJob(artifact, job);
  }

  if (job.status === "failed") {
    return {
      ...artifact,
      label: `Failed: ${artifact.meta?.toolName?.split(".").pop() ?? "action"}`,
      meta: {
        ...artifact.meta,
        toolStatus: "failed",
        error: job.errorMessage ?? "Background job failed.",
        subtitle: job.errorMessage ?? "Background job failed.",
      },
    };
  }

  return artifact;
}

export function reconcileMessageArtifacts(
  artifacts: MessageArtifact[] | undefined,
  jobsById: Map<string, IntegrationJobRecord>,
): { artifacts: MessageArtifact[] | undefined; changed: boolean } {
  if (!artifacts?.length) return { artifacts, changed: false };

  let changed = false;
  const next = artifacts.map((artifact) => {
    const jobId = queuedArtifactJobId(artifact);
    if (!jobId) return artifact;
    const reconciled = reconcileQueuedArtifact(artifact, jobsById.get(jobId));
    if (reconciled !== artifact) changed = true;
    return reconciled;
  });

  return { artifacts: changed ? next : artifacts, changed };
}

export function collectQueuedArtifactJobIds(messages: RoomMessage[]): string[] {
  const ids = new Set<string>();
  for (const message of messages) {
    for (const artifact of message.artifacts ?? []) {
      const jobId = queuedArtifactJobId(artifact);
      if (jobId) ids.add(jobId);
    }
  }
  return [...ids];
}

export function replaceQueuedArtifactInList(
  artifacts: MessageArtifact[] | undefined,
  jobId: string,
  replacement: MessageArtifact,
): MessageArtifact[] {
  const list = artifacts ?? [];
  const index = list.findIndex((artifact) => queuedArtifactJobId(artifact) === jobId);
  if (index === -1) return [...list, replacement];
  const next = [...list];
  next[index] = replacement;
  return next;
}
