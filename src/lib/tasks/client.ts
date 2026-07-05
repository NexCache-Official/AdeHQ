import { authHeaders } from "@/lib/api/auth-client";

export async function deleteTaskClient(
  taskId: string,
): Promise<{ deleted: true; taskId: string }> {
  const headers = await authHeaders();
  const res = await fetch(`/api/tasks/${taskId}`, { method: "DELETE", headers });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error ?? "Could not delete task.");
  return { deleted: true, taskId };
}
