// ===========================================================================
// AdeHQ tasks adapter — tasks.createTask writes to the main tasks table so
// follow-ups appear in the existing Tasks UI; CRM links go to crm_tasks.
// ===========================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolExecutionContext, ToolExecutionOutput } from "@/lib/integrations/types";
import type { CreateTaskArgs } from "@/lib/integrations/registry/tool-definitions";
import { ensureGeneralTopic } from "@/lib/server/topic-helpers";
import { nowISO, uid } from "@/lib/utils";

export async function createTask(
  client: SupabaseClient,
  ctx: ToolExecutionContext,
  args: CreateTaskArgs,
): Promise<ToolExecutionOutput> {
  if (!ctx.roomId) {
    throw new Error("Task creation needs a room context.");
  }

  let topicId = ctx.topicId;
  if (!topicId) {
    const general = await ensureGeneralTopic(client, ctx.workspaceId, ctx.roomId);
    topicId = general.id;
  }

  const taskId = uid("task");
  const { error } = await client.from("tasks").insert({
    workspace_id: ctx.workspaceId,
    id: taskId,
    room_id: ctx.roomId,
    topic_id: topicId,
    title: args.title.trim(),
    description: args.description ?? null,
    status: "open",
    priority: args.priority ?? "medium",
    assignee_type: args.assigneeType ?? "ai",
    assignee_id: args.assigneeId ?? ctx.employeeId,
    created_from: "integration_tool",
    created_by_run_id: ctx.agentRunId ?? null,
    due_date: args.dueDate ?? null,
    created_at: nowISO(),
    updated_at: nowISO(),
  });
  if (error) throw error;

  if (args.contactId || args.dealId) {
    const { error: crmError } = await client.from("crm_tasks").insert({
      workspace_id: ctx.workspaceId,
      id: uid("crmtask"),
      title: args.title.trim(),
      description: args.description ?? null,
      status: "open",
      due_date: args.dueDate ?? null,
      contact_id: args.contactId ?? null,
      deal_id: args.dealId ?? null,
      assignee_employee_id: args.assigneeId ?? ctx.employeeId,
      created_by_type: "ai",
      created_by_id: ctx.employeeId,
    });
    if (crmError) {
      console.warn("[AdeHQ integrations] crm_tasks mirror failed", crmError);
    }
  }

  return {
    summary: `Created follow-up task "${args.title}".`,
    payload: { taskId, title: args.title },
    objectId: taskId,
    workLogAction: "task_created",
    relatedEntityType: "task",
    relatedEntityId: taskId,
  };
}
