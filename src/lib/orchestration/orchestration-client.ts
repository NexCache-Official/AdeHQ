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

export async function fetchTopicOrchestration(
  topicId: string,
): Promise<StoredOrchestrationRecord | null> {
  const headers = await authHeaders();
  const res = await fetch(`/api/topics/${topicId}/orchestration`, { headers });
  if (!res.ok) return null;
  const payload = await res.json();
  return (payload.orchestration as StoredOrchestrationRecord | null) ?? null;
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
