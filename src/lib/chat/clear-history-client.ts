import { authHeaders } from "@/lib/api/auth-client";
import { parseJsonResponse } from "@/lib/api/parse-json-response";

export async function clearTopicChatHistoryClient(topicId: string): Promise<{
  deletedMessageCount: number;
}> {
  const res = await fetch(`/api/topics/${topicId}/clear-chat`, {
    method: "POST",
    headers: await authHeaders(),
  });
  const data = await parseJsonResponse<{ deletedMessageCount?: number; error?: string }>(res);
  if (!res.ok) throw new Error(data.error ?? "Failed to clear chat history.");
  return { deletedMessageCount: data.deletedMessageCount ?? 0 };
}

export async function clearRoomChatHistoryClient(
  roomId: string,
  workspaceId: string,
): Promise<{
  deletedMessageCount: number;
  clearedTopicCount: number;
}> {
  const params = new URLSearchParams({ workspaceId });
  const res = await fetch(`/api/rooms/${roomId}/clear-chat?${params.toString()}`, {
    method: "POST",
    headers: await authHeaders(),
  });
  const data = await parseJsonResponse<{
    deletedMessageCount?: number;
    clearedTopicCount?: number;
    error?: string;
  }>(res);
  if (!res.ok) throw new Error(data.error ?? "Failed to clear room chat history.");
  return {
    deletedMessageCount: data.deletedMessageCount ?? 0,
    clearedTopicCount: data.clearedTopicCount ?? 0,
  };
}
