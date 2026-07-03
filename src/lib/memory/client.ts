import { authHeaders } from "@/lib/api/auth-client";
import type { MemoryEntry } from "@/lib/types";
import { MEMORY_UPDATED_EVENT, notifyMemoryUpdated } from "@/lib/topic-summary/client";

export type MemoryPatchBody = {
  title?: string;
  content?: string;
  category?: string;
  tags?: string[];
  status?: MemoryEntry["status"];
};

async function parseMemoryResponse(res: Response): Promise<MemoryEntry> {
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error ?? "Memory request failed.");
  return payload.memory as MemoryEntry;
}

export async function patchMemoryClient(
  memoryId: string,
  patch: MemoryPatchBody,
): Promise<MemoryEntry> {
  const headers = await authHeaders();
  const res = await fetch(`/api/memory/${memoryId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(patch),
  });
  const memory = await parseMemoryResponse(res);
  notifyMemoryUpdated({ memoryId: memory.id, memory });
  return memory;
}

export async function archiveMemoryClient(memoryId: string): Promise<MemoryEntry> {
  return patchMemoryClient(memoryId, { status: "archived" });
}

export async function deleteMemoryClient(memoryId: string): Promise<MemoryEntry> {
  const headers = await authHeaders();
  const res = await fetch(`/api/memory/${memoryId}`, { method: "DELETE", headers });
  const memory = await parseMemoryResponse(res);
  notifyMemoryUpdated({ memoryId: memory.id, memory });
  return memory;
}

export { MEMORY_UPDATED_EVENT };
