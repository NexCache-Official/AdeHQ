import type { SupabaseClient } from "@supabase/supabase-js";
import type { AIEmployee } from "@/lib/types";
import { listOpenTopicTasks, logAssignmentTask } from "@/lib/tasks/task-book";
import { evaluateEmployeeAdmission } from "@/lib/tasks/admission";
import { nowISO } from "@/lib/utils";
import { queueAgentRuns } from "@/lib/server/queue-agent-runs";
import { drainQueuedAgentRunsForRoot } from "@/lib/server/background-agent-drainer";

/**
 * Silent steward leftover pass: never posts to chat.
 * Promotes idle AI work or schedules an AI to ask a human for input.
 */
export async function sweepTopicLeftoverTasks(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    roomId: string;
    topicId: string;
    employees: AIEmployee[];
    /** Prefer this employee when asking humans for input. */
    preferredAskerEmployeeId?: string;
  },
): Promise<{ promoted: number; humanAsks: number; assigned: number }> {
  const open = await listOpenTopicTasks(client, params.workspaceId, params.topicId);
  if (!open.length) return { promoted: 0, humanAsks: 0, assigned: 0 };

  let promoted = 0;
  let humanAsks = 0;
  let assigned = 0;

  for (const task of open) {
    // Capacity-deferred AI work: promote when lane is free.
    if (
      task.assigneeType === "ai" &&
      task.blockedReason === "capacity" &&
      (task.status === "open" || task.status === "blocked")
    ) {
      const admission = await evaluateEmployeeAdmission(client, {
        workspaceId: params.workspaceId,
        employeeId: task.assigneeId,
        workClass: task.workClass ?? "interactive",
      });
      if (!admission.admit) continue;

      const employee = params.employees.find((e) => e.id === task.assigneeId);
      if (!employee) continue;

      const prompt = [
        `Continue open task from the task book (do the work now):`,
        `Title: ${task.title}`,
        task.description ? `Details: ${task.description}` : "",
        `Use tools if needed. When done, mark progress clearly.`,
      ]
        .filter(Boolean)
        .join("\n");

      const { queued } = await queueAgentRuns(client, {
        workspaceId: params.workspaceId,
        roomId: params.roomId,
        topicId: params.topicId,
        triggerMessageId: task.sourceMessageId ?? task.id,
        rootTriggerMessageId: task.sourceMessageId ?? task.id,
        responders: [
          {
            employee,
            reason: "task_follow_up",
            runMetadata: {
              workClass: task.workClass ?? "interactive",
              taskBookTaskId: task.id,
              leftoverSweep: true,
            },
          },
        ],
        content: prompt,
        skipAdmission: true,
      });

      if (queued[0]) {
        await client
          .from("tasks")
          .update({
            status: "in_progress",
            blocked_reason: null,
            queue_position: null,
            agent_run_id: queued[0].runId,
            updated_at: nowISO(),
          })
          .eq("workspace_id", params.workspaceId)
          .eq("id", task.id);
        void drainQueuedAgentRunsForRoot(client, {
          workspaceId: params.workspaceId,
          rootTriggerMessageId: task.sourceMessageId ?? task.id,
        });
        promoted += 1;
      }
      continue;
    }

    // Waiting on human: queue an AI to ask (steward never speaks).
    if (
      task.status === "waiting_on_human" ||
      task.blockedReason === "needs_human_input"
    ) {
      const askerId =
        params.preferredAskerEmployeeId ??
        (task.assigneeType === "ai" ? task.assigneeId : undefined) ??
        params.employees[0]?.id;
      const asker = params.employees.find((e) => e.id === askerId);
      if (!asker) continue;

      // Avoid duplicate ask runs for the same task in a short window.
      const metaKey = `human_ask:${task.id}`;
      const { data: recent } = await client
        .from("agent_runs")
        .select("id, started_at, run_metadata")
        .eq("workspace_id", params.workspaceId)
        .eq("topic_id", params.topicId)
        .eq("employee_id", asker.id)
        .order("started_at", { ascending: false })
        .limit(5);
      const alreadyAsked = ((recent as Array<Record<string, unknown>> | null) ?? []).some(
        (row) => {
          const meta = (row.run_metadata ?? {}) as Record<string, unknown>;
          return meta.humanAskTaskId === task.id;
        },
      );
      if (alreadyAsked) continue;

      const humanMention =
        task.assigneeType === "human" ? task.assigneeId : "the relevant teammate";
      const prompt = [
        `[System intent: request_human_input — you must ask a human in this room. The steward will not speak.]`,
        `Open task "${task.title}" is blocked on human input.`,
        task.description ? `Context: ${task.description}` : "",
        `Ask ${humanMention} clearly for the missing decision/details (one short message). Do not invent the answer.`,
      ]
        .filter(Boolean)
        .join("\n");

      const { queued } = await queueAgentRuns(client, {
        workspaceId: params.workspaceId,
        roomId: params.roomId,
        topicId: params.topicId,
        triggerMessageId: task.sourceMessageId ?? task.id,
        responders: [
          {
            employee: asker,
            reason: "task_follow_up",
            runMetadata: {
              workClass: "interactive",
              intent: "request_human_input",
              humanAskTaskId: task.id,
              leftoverSweep: true,
              humanAskKey: metaKey,
            },
          },
        ],
        content: prompt,
        skipAdmission: true,
      });
      if (queued[0]) {
        void drainQueuedAgentRunsForRoot(client, {
          workspaceId: params.workspaceId,
          rootTriggerMessageId: task.sourceMessageId ?? task.id,
        });
        humanAsks += 1;
      }
      continue;
    }

    // Unassigned-looking AI tasks with no agent_run yet — assign best-fit if still open.
    if (
      task.assigneeType === "ai" &&
      task.status === "open" &&
      !task.agentRunId &&
      !task.blockedReason
    ) {
      const employee = params.employees.find((e) => e.id === task.assigneeId);
      if (!employee) {
        // Pick first roster employee silently.
        const fallback = params.employees[0];
        if (!fallback) continue;
        await client
          .from("tasks")
          .update({
            assignee_id: fallback.id,
            created_by_type: "steward",
            updated_at: nowISO(),
          })
          .eq("workspace_id", params.workspaceId)
          .eq("id", task.id);
        await logAssignmentTask({
          client,
          workspaceId: params.workspaceId,
          roomId: params.roomId,
          topicId: params.topicId,
          title: `Assigned: ${task.title}`,
          description: "Silent steward assigned unowned topic work.",
          assigneeEmployeeId: fallback.id,
          createdByType: "steward",
          createdById: "steward",
          sourceMessageId: task.sourceMessageId,
          workClass: "interactive",
          status: "open",
        });
        assigned += 1;
      }
    }
  }

  return { promoted, humanAsks, assigned };
}
