import { authHeaders } from "@/lib/api/auth-client";
import type { Task, TaskPriority, TaskStatus } from "@/lib/types";

export async function createTaskClient(payload: {
  workspaceId: string;
  roomId: string;
  topicId?: string | null;
  title: string;
  description?: string | null;
  priority?: TaskPriority;
  assigneeType: "human" | "ai";
  assigneeId: string;
  dueDate?: string | null;
  promote?: boolean;
}): Promise<{ task: Task; promoted: boolean; runId: string | null }> {
  const headers = await authHeaders();
  const res = await fetch("/api/tasks", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? "Could not create task.");
  return body as { task: Task; promoted: boolean; runId: string | null };
}

export async function deleteTaskClient(
  taskId: string,
): Promise<{ deleted: true; taskId: string }> {
  const headers = await authHeaders();
  const res = await fetch(`/api/tasks/${taskId}`, { method: "DELETE", headers });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error ?? "Could not delete task.");
  return { deleted: true, taskId };
}

export async function patchTaskClient(
  taskId: string,
  patch: Partial<{
    title: string;
    description: string | null;
    status: TaskStatus;
    priority: TaskPriority;
    assigneeType: Task["assigneeType"];
    assigneeId: string;
    dueDate: string | null;
  }>,
): Promise<Task> {
  const headers = await authHeaders();
  const res = await fetch(`/api/tasks/${taskId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(patch),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error ?? "Could not update task.");
  return payload.task as Task;
}
