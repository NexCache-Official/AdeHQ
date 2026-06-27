import type { SupabaseClient } from "@supabase/supabase-js";
import { enforceEmployeePermissions } from "@/lib/ai/enforce-permissions";
import { routeEmployeeResponse } from "@/lib/ai/model-router";
import type { EmployeeResponse } from "@/lib/types";
import {
  loadRoomContext,
  persistEmployeeEffects,
  type RoomContext,
} from "@/lib/server/room-messages";

export async function processEmployeeResponse(
  client: SupabaseClient,
  ctx: RoomContext,
  employeeId: string,
  content: string,
  options: { mode?: "mock" | "live"; triggerMessageId?: string } = {},
): Promise<EmployeeResponse & { aiMessageId: string; aiMode: string }> {
  const employee = ctx.employees.find((e) => e.id === employeeId);
  if (!employee) {
    throw new Error("Employee not found in this room.");
  }

  if (!ctx.room.aiEmployees.includes(employeeId)) {
    throw new Error("Employee is not a member of this room.");
  }

  await client
    .from("ai_employees")
    .update({ status: "working", last_active_at: new Date().toISOString() })
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", employeeId);

  const roomWithMessages = {
    ...ctx.room,
    messages: [
      ...ctx.room.messages,
      {
        id: options.triggerMessageId ?? "trigger",
        roomId: ctx.room.id,
        senderType: "human" as const,
        senderId: "user",
        senderName: "User",
        content,
        createdAt: new Date().toISOString(),
      },
    ],
  };

  const { response, aiMode } = await routeEmployeeResponse(
    {
      employee,
      room: roomWithMessages,
      message: content,
      allEmployees: ctx.employees,
      recentMemory: ctx.recentMemory,
      workspaceName: ctx.workspaceName,
      openTasks: ctx.openTasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
      })),
      humanParticipants: ctx.humanParticipants,
    },
    {
      mode: options.mode,
      provider: employee.provider,
      context: { workspaceId: ctx.workspaceId, roomId: ctx.room.id },
    },
  );

  const effect = enforceEmployeePermissions(employee, response.effect);

  const { aiMessage } = await persistEmployeeEffects(
    client,
    ctx.workspaceId,
    ctx.room.id,
    employee,
    response.reply,
    effect,
    options.triggerMessageId,
  );

  return {
    ...response,
    effect,
    aiMessageId: aiMessage.id,
    aiMode,
  };
}
