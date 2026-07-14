import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { assertCanAccessRoom } from "@/lib/server/room-access";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { queueAgentRuns } from "@/lib/server/queue-agent-runs";
import { drainQueuedAgentRunsForRoot } from "@/lib/server/background-agent-drainer";
import { nowISO } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Regenerate / undo-last-AI-action v1:
 * Marks the AI message as superseded and re-queues the same employee on the
 * original human trigger (soft undo — does not reverse CRM/Drive side effects).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { roomId: string; messageId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const { data: msg, error } = await client
      .from("messages")
      .select("*")
      .eq("id", params.messageId)
      .maybeSingle();
    if (error) throw error;
    if (!msg) return NextResponse.json({ error: "Message not found." }, { status: 404 });

    const workspaceId = String(msg.workspace_id);
    const roomId = String(msg.room_id ?? params.roomId);
    const topicId = msg.topic_id ? String(msg.topic_id) : null;
    const { role } = await requireWorkspaceMembership(client, workspaceId, user.id);
    await assertCanAccessRoom(client, workspaceId, roomId, user.id, role);

    if (String(msg.sender_type) !== "ai") {
      return NextResponse.json({ error: "Only AI messages can be regenerated." }, { status: 400 });
    }
    if (!topicId) {
      return NextResponse.json({ error: "Message has no topic." }, { status: 400 });
    }

    const employeeId = String(msg.sender_id);
    const triggerMessageId = msg.reply_to_message_id
      ? String(msg.reply_to_message_id)
      : String(msg.id);

    const artifacts = Array.isArray(msg.artifacts) ? [...(msg.artifacts as unknown[])] : [];
    artifacts.push({
      id: `regen-${Date.now()}`,
      type: "system_note",
      label: "Superseded — regenerating",
      meta: { regeneratedAt: nowISO(), byUserId: user.id },
    });

    await client
      .from("messages")
      .update({
        artifacts,
        metadata: {
          ...((msg.metadata as Record<string, unknown>) ?? {}),
          superseded: true,
          regeneratedAt: nowISO(),
        },
        updated_at: nowISO(),
      })
      .eq("workspace_id", workspaceId)
      .eq("id", params.messageId);

    const secret = createSupabaseSecretClient();
    const { data: emp } = await secret
      .from("ai_employees")
      .select("id, name, role, role_key, provider, model_mode")
      .eq("workspace_id", workspaceId)
      .eq("id", employeeId)
      .maybeSingle();
    if (!emp) {
      return NextResponse.json({ error: "Employee not found." }, { status: 404 });
    }

    const { data: trigger } = await secret
      .from("messages")
      .select("content")
      .eq("workspace_id", workspaceId)
      .eq("id", triggerMessageId)
      .maybeSingle();

    const content =
      (trigger?.content ? String(trigger.content) : "") ||
      "Please regenerate your previous answer with a clearer, corrected version.";

    const { queued, blocked } = await queueAgentRuns(secret, {
      workspaceId,
      roomId,
      topicId,
      triggerMessageId,
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
          reason: "manual_retry",
          runMetadata: {
            regenerateOfMessageId: params.messageId,
            workClass: "interactive",
          },
        },
      ],
      content: `${content}\n\n[System: Regenerate — improve on your prior reply; do not repeat mistakes.]`,
      skipAdmission: true,
      createdByType: "human",
      createdById: user.id,
    });

    if (queued[0]) {
      void drainQueuedAgentRunsForRoot(secret, {
        workspaceId,
        rootTriggerMessageId: triggerMessageId,
      });
    }

    return NextResponse.json({
      ok: true,
      supersededMessageId: params.messageId,
      queuedRunId: queued[0]?.runId ?? null,
      blocked,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[regenerate]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Regenerate failed." },
      { status: 500 },
    );
  }
}
