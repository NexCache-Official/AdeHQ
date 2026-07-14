import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { assertCanAccessRoom } from "@/lib/server/room-access";
import { insertTaskBookItem } from "@/lib/tasks/task-book";
import { classifyWorkClass } from "@/lib/tasks/work-classes";
import { evaluateEmployeeAdmission } from "@/lib/tasks/admission";
import { queueAgentRuns } from "@/lib/server/queue-agent-runs";
import { drainQueuedAgentRunsForRoot } from "@/lib/server/background-agent-drainer";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { nowISO } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  workspaceId: z.string().uuid(),
  roomId: z.string().min(1),
  topicId: z.string().optional().nullable(),
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  assigneeType: z.enum(["human", "ai"]).default("ai"),
  assigneeId: z.string().min(1),
  dueDate: z.string().nullable().optional(),
  promote: z.boolean().optional(),
});

/**
 * Human-created task book entries — assign to AI or human in a room/topic.
 * When assigned to an AI with capacity, promotes a run (steward never speaks).
 */
export async function POST(request: NextRequest) {
  try {
    const { user, client } = await requireAuthUser(request);
    const body = CreateSchema.parse(await request.json());
    const { role } = await requireWorkspaceMembership(client, body.workspaceId, user.id);
    await assertCanAccessRoom(client, body.workspaceId, body.roomId, user.id, role);

    const workClass = classifyWorkClass({
      message: `${body.title} ${body.description ?? ""}`,
    });

    const task = await insertTaskBookItem(client, {
      workspaceId: body.workspaceId,
      roomId: body.roomId,
      topicId: body.topicId ?? null,
      title: body.title,
      description: body.description ?? null,
      priority: body.priority ?? "medium",
      assigneeType: body.assigneeType,
      assigneeId: body.assigneeId,
      createdByType: "human",
      createdById: user.id,
      createdFrom: "human_ui",
      workClass,
      dueDate: body.dueDate ?? null,
      status: "open",
    });

    let promotedRunId: string | null = null;
    if (body.assigneeType === "ai" && body.promote !== false && body.topicId) {
      const secret = createSupabaseSecretClient();
      const admission = await evaluateEmployeeAdmission(secret, {
        workspaceId: body.workspaceId,
        employeeId: body.assigneeId,
        workClass,
      });

      if (!admission.admit) {
        await client
          .from("tasks")
          .update({
            blocked_reason: "capacity",
            queue_position: admission.queuePosition,
            updated_at: nowISO(),
          })
          .eq("workspace_id", body.workspaceId)
          .eq("id", task.id);
        return NextResponse.json({
          task: {
            ...task,
            blockedReason: "capacity" as const,
            queuePosition: admission.queuePosition,
          },
          promoted: false,
          reason: "Employee at capacity — task logged.",
        });
      }

      const { data: emp } = await secret
        .from("ai_employees")
        .select("id, name, role, role_key, provider, model_mode")
        .eq("workspace_id", body.workspaceId)
        .eq("id", body.assigneeId)
        .maybeSingle();

      if (emp) {
        const prompt = [
          `Human assigned you a task from the task book. Do the work now.`,
          `Title: ${task.title}`,
          task.description ? `Details: ${task.description}` : "",
          `Use tools when needed. When finished, summarize clearly.`,
        ]
          .filter(Boolean)
          .join("\n");

        const { queued } = await queueAgentRuns(secret, {
          workspaceId: body.workspaceId,
          roomId: body.roomId,
          topicId: body.topicId,
          triggerMessageId: task.id,
          responders: [
            {
              employee: {
                id: String(emp.id),
                name: String(emp.name),
                role: String(emp.role ?? "Specialist"),
                roleKey: String(emp.role_key ?? "general") as never,
                provider: String(emp.provider ?? "openai") as never,
                modelMode: (emp.model_mode as "fast" | "balanced" | "strong") ?? "balanced",
                status: "idle",
                tools: [],
                permissions: {
                  createTasks: true,
                  editMemory: true,
                  requestApprovals: true,
                  useIntegrations: true,
                },
              } as never,
              reason: "task_follow_up",
              runMetadata: {
                workClass,
                taskBookTaskId: task.id,
                humanAssigned: true,
              },
            },
          ],
          content: prompt,
          skipAdmission: true,
          createdByType: "human",
          createdById: user.id,
        });

        if (queued[0]) {
          promotedRunId = queued[0].runId;
          await client
            .from("tasks")
            .update({
              status: "in_progress",
              agent_run_id: queued[0].runId,
              updated_at: nowISO(),
            })
            .eq("workspace_id", body.workspaceId)
            .eq("id", task.id);
          void drainQueuedAgentRunsForRoot(secret, {
            workspaceId: body.workspaceId,
            rootTriggerMessageId: task.id,
          });
        }
      }
    }

    return NextResponse.json({
      task,
      promoted: Boolean(promotedRunId),
      runId: promotedRunId,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues[0]?.message ?? "Invalid body." }, { status: 400 });
    }
    console.error("[api/tasks POST]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not create task." },
      { status: 500 },
    );
  }
}
