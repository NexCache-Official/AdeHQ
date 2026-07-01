import { authHeaders } from "@/lib/api/auth-client";
import type { PersistedOrchestrationEmployeeStatus, StoredOrchestrationRecord } from "@/lib/orchestration/types";
import type { OrchestrationPhase } from "@/lib/orchestration/orchestration-labels";

const UI_TO_PERSISTED_PHASE: Record<
  OrchestrationPhase,
  PersistedOrchestrationEmployeeStatus["phase"]
> = {
  planned: "planned",
  reading: "reading",
  replying: "replying",
  waiting: "waiting",
  completed: "completed",
  failed: "failed",
};

export type TopicOrchestrationPayload = {
  active: StoredOrchestrationRecord | null;
  history: StoredOrchestrationRecord[];
};

export async function fetchTopicOrchestrations(
  topicId: string,
  excludeIds?: string[],
): Promise<TopicOrchestrationPayload> {
  const headers = await authHeaders();
  const query = excludeIds?.length
    ? `?excludeIds=${encodeURIComponent(excludeIds.join(","))}`
    : "";
  const res = await fetch(`/api/topics/${topicId}/orchestration${query}`, { headers });
  if (!res.ok) return { active: null, history: [] };
  const payload = await res.json();
  return {
    active: (payload.active as StoredOrchestrationRecord | null) ?? null,
    history: (payload.history as StoredOrchestrationRecord[]) ?? [],
  };
}

/** @deprecated Use fetchTopicOrchestrations */
export async function fetchTopicOrchestration(
  topicId: string,
): Promise<StoredOrchestrationRecord | null> {
  const { active, history } = await fetchTopicOrchestrations(topicId);
  return active ?? history[0] ?? null;
}

export async function refreshTopicWorkLog(topicId: string) {
  const headers = await authHeaders();
  const res = await fetch(`/api/topics/${topicId}/work-log`, { headers });
  if (!res.ok) return null;
  const payload = await res.json();
  return (payload.events ?? []) as import("@/lib/types").WorkLogEvent[];
}

export async function patchOrchestrationEmployeeStatus(
  orchestrationId: string,
  employeeId: string,
  phase: OrchestrationPhase,
  opts?: {
    detail?: string;
    waitingOnEmployeeName?: string;
    runId?: string;
  },
): Promise<void> {
  const headers = await authHeaders();
  await fetch(`/api/orchestrations/${orchestrationId}/status`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      employeeId,
      phase: UI_TO_PERSISTED_PHASE[phase],
      detail: opts?.detail ?? null,
      waitingOnEmployeeName: opts?.waitingOnEmployeeName ?? null,
      runId: opts?.runId ?? null,
    }),
  }).catch(() => {
    // non-blocking
  });
}
