const STORAGE_PREFIX = "adehq:dismissed-orchestrations:";

export function readDismissedOrchestrationIds(topicId: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${topicId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function dismissOrchestrationId(topicId: string, orchestrationId: string): void {
  if (typeof window === "undefined") return;
  const existing = new Set(readDismissedOrchestrationIds(topicId));
  existing.add(orchestrationId);
  localStorage.setItem(
    `${STORAGE_PREFIX}${topicId}`,
    JSON.stringify(Array.from(existing)),
  );
}
