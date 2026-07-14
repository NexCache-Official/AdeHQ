import type { SupabaseClient } from "@supabase/supabase-js";
import type { Task, TaskPriority, TaskStatus } from "@/lib/types";
import { taskFromDbRow } from "@/lib/tasks/task-book";
import { nowISO } from "@/lib/utils";

type DbRow = Record<string, unknown>;

function taskFromRow(row: DbRow): Task {
  return taskFromDbRow(row);
}

export async function updateTaskRecord(
  client: SupabaseClient,
  workspaceId: string,
  taskId: string,
  patch: {
    title?: string;
    description?: string | null;
    status?: TaskStatus;
    priority?: TaskPriority;
    assigneeType?: Task["assigneeType"];
    assigneeId?: string;
    dueDate?: string | null;
  },
): Promise<Task> {
  const { data: existing, error: loadError } = await client
    .from("tasks")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", taskId)
    .maybeSingle();
  if (loadError) throw loadError;
  if (!existing) throw new Error("Task not found.");

  const row = existing as DbRow;
  const update: DbRow = { updated_at: nowISO() };
  if (patch.title !== undefined) update.title = patch.title.trim();
  if (patch.description !== undefined) update.description = patch.description;
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.priority !== undefined) update.priority = patch.priority;
  if (patch.assigneeType !== undefined) update.assignee_type = patch.assigneeType;
  if (patch.assigneeId !== undefined) update.assignee_id = patch.assigneeId;
  if (patch.dueDate !== undefined) update.due_date = patch.dueDate;

  const { error } = await client
    .from("tasks")
    .update(update)
    .eq("workspace_id", workspaceId)
    .eq("id", taskId);
  if (error) throw error;

  const { data: updated, error: reloadError } = await client
    .from("tasks")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", taskId)
    .maybeSingle();
  if (reloadError) throw reloadError;
  if (!updated) throw new Error("Task update failed.");

  return taskFromRow(updated as DbRow);
}
