import type { SupabaseClient } from "@supabase/supabase-js";
import type { Task, TaskPriority, TaskStatus } from "@/lib/types";
import { nowISO, uid } from "@/lib/utils";
import type { WorkClass } from "@/lib/tasks/work-classes";

export type TaskCreatedByType = "human" | "ai_employee" | "steward";
export type TaskBlockedReason = "needs_human_input" | "capacity" | "depends_on_task";

export type TaskBookInsert = {
  workspaceId: string;
  roomId: string;
  topicId?: string | null;
  title: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigneeType: "human" | "ai";
  assigneeId: string;
  createdByType: TaskCreatedByType;
  createdById?: string | null;
  createdFrom?: string | null;
  sourceMessageId?: string | null;
  agentRunId?: string | null;
  integrationJobId?: string | null;
  workClass?: WorkClass | null;
  queuePosition?: number | null;
  blockedReason?: TaskBlockedReason | null;
  dueDate?: string | null;
  transferredFromEmployeeId?: string | null;
  transferredToEmployeeId?: string | null;
};

type DbRow = Record<string, unknown>;

export function taskFromDbRow(row: DbRow): Task {
  return {
    id: String(row.id),
    roomId: String(row.room_id),
    topicId: row.topic_id ? String(row.topic_id) : undefined,
    title: String(row.title ?? ""),
    description: row.description ? String(row.description) : undefined,
    status: row.status as TaskStatus,
    priority: row.priority as TaskPriority,
    assigneeType: row.assignee_type as Task["assigneeType"],
    assigneeId: String(row.assignee_id),
    createdFrom: row.created_from ? String(row.created_from) : undefined,
    createdByRunId: row.created_by_run_id ? String(row.created_by_run_id) : undefined,
    createdByType: row.created_by_type
      ? (String(row.created_by_type) as Task["createdByType"])
      : undefined,
    createdById: row.created_by_id ? String(row.created_by_id) : undefined,
    sourceMessageId: row.source_message_id ? String(row.source_message_id) : undefined,
    agentRunId: row.agent_run_id ? String(row.agent_run_id) : undefined,
    integrationJobId: row.integration_job_id ? String(row.integration_job_id) : undefined,
    workClass: row.work_class ? (String(row.work_class) as Task["workClass"]) : undefined,
    queuePosition:
      row.queue_position != null && Number.isFinite(Number(row.queue_position))
        ? Number(row.queue_position)
        : undefined,
    blockedReason: row.blocked_reason
      ? (String(row.blocked_reason) as Task["blockedReason"])
      : undefined,
    transferredFromEmployeeId: row.transferred_from_employee_id
      ? String(row.transferred_from_employee_id)
      : undefined,
    transferredToEmployeeId: row.transferred_to_employee_id
      ? String(row.transferred_to_employee_id)
      : undefined,
    dueDate: row.due_date ? String(row.due_date) : undefined,
    createdAt: String(row.created_at ?? nowISO()),
    updatedAt: String(row.updated_at ?? row.created_at ?? nowISO()),
  };
}

/** Insert a task-book row (human, AI, or silent steward). */
export async function insertTaskBookItem(
  client: SupabaseClient,
  input: TaskBookInsert,
): Promise<Task> {
  const taskId = uid("task");
  const row = {
    workspace_id: input.workspaceId,
    id: taskId,
    room_id: input.roomId,
    topic_id: input.topicId ?? null,
    title: input.title.trim(),
    description: input.description ?? null,
    status: input.status ?? "open",
    priority: input.priority ?? "medium",
    assignee_type: input.assigneeType,
    assignee_id: input.assigneeId,
    created_from: input.createdFrom ?? input.createdByType,
    created_by_run_id: input.agentRunId ?? null,
    created_by_type: input.createdByType,
    created_by_id: input.createdById ?? null,
    source_message_id: input.sourceMessageId ?? null,
    agent_run_id: input.agentRunId ?? null,
    integration_job_id: input.integrationJobId ?? null,
    work_class: input.workClass ?? null,
    queue_position: input.queuePosition ?? null,
    blocked_reason: input.blockedReason ?? null,
    transferred_from_employee_id: input.transferredFromEmployeeId ?? null,
    transferred_to_employee_id: input.transferredToEmployeeId ?? null,
    due_date: input.dueDate ?? null,
    created_at: nowISO(),
    updated_at: nowISO(),
  };

  const { error } = await client.from("tasks").insert(row);
  if (error) throw error;
  return taskFromDbRow(row);
}

export async function transferTaskToEmployee(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    taskId: string;
    fromEmployeeId: string;
    toEmployeeId: string;
  },
): Promise<void> {
  const { error } = await client
    .from("tasks")
    .update({
      assignee_type: "ai",
      assignee_id: params.toEmployeeId,
      transferred_from_employee_id: params.fromEmployeeId,
      transferred_to_employee_id: params.toEmployeeId,
      created_by_type: "ai_employee",
      updated_at: nowISO(),
    })
    .eq("workspace_id", params.workspaceId)
    .eq("id", params.taskId);
  if (error) throw error;
}

/** Auto-log work when a steward/AI assigns an employee to a message. */
export async function logAssignmentTask(params: {
  client: SupabaseClient;
  workspaceId: string;
  roomId: string;
  topicId: string;
  title: string;
  description?: string;
  assigneeEmployeeId: string;
  createdByType: TaskCreatedByType;
  createdById?: string;
  sourceMessageId?: string;
  agentRunId?: string;
  workClass?: WorkClass;
  status?: TaskStatus;
  blockedReason?: TaskBlockedReason;
  queuePosition?: number;
}): Promise<Task | null> {
  try {
    return await insertTaskBookItem(params.client, {
      workspaceId: params.workspaceId,
      roomId: params.roomId,
      topicId: params.topicId,
      title: params.title.slice(0, 160),
      description: params.description,
      assigneeType: "ai",
      assigneeId: params.assigneeEmployeeId,
      createdByType: params.createdByType,
      createdById: params.createdById,
      createdFrom: "task_book",
      sourceMessageId: params.sourceMessageId,
      agentRunId: params.agentRunId,
      workClass: params.workClass ?? "interactive",
      status: params.status ?? "open",
      blockedReason: params.blockedReason,
      queuePosition: params.queuePosition,
    });
  } catch (err) {
    console.warn("[task-book] logAssignmentTask failed", err);
    return null;
  }
}

export async function listOpenTopicTasks(
  client: SupabaseClient,
  workspaceId: string,
  topicId: string,
): Promise<Task[]> {
  const { data, error } = await client
    .from("tasks")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("topic_id", topicId)
    .in("status", ["open", "in_progress", "waiting_on_human", "blocked"])
    .order("created_at", { ascending: true })
    .limit(40);
  if (error) {
    console.warn("[task-book] listOpenTopicTasks failed", error);
    return [];
  }
  return ((data as DbRow[] | null) ?? []).map(taskFromDbRow);
}
