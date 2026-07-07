import { authHeaders } from "@/lib/api/auth-client";
import type { Task, TaskPriority, TaskStatus } from "@/lib/types";

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
