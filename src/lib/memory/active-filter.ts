import type { MemoryEntry, MemoryStatus } from "@/lib/types";

export const INACTIVE_MEMORY_STATUSES: MemoryStatus[] = ["archived", "superseded"];

export function isActiveMemory(entry: Pick<MemoryEntry, "status" | "deletedAt" | "metadata">): boolean {
  if (entry.deletedAt) return false;
  const metaDeleted = entry.metadata?.deletedAt;
  if (typeof metaDeleted === "string" && metaDeleted) return false;
  return !INACTIVE_MEMORY_STATUSES.includes(entry.status);
}

export function filterActiveMemories<T extends Pick<MemoryEntry, "status" | "deletedAt" | "metadata">>(
  entries: T[],
): T[] {
  return entries.filter(isActiveMemory);
}
