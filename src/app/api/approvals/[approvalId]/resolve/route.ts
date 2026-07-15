import { NextRequest, NextResponse } from "next/server";
import {
  AuthError,
  requireAuthUser,
  requireWorkspaceMembership,
} from "@/lib/supabase/auth-server";
import {
  canResolveApprovals,
  resolveHumanIntegrationPermissions,
} from "@/lib/integrations/permissions";
import { runToolCall } from "@/lib/integrations/executor/tool-executor";
import { buildIdempotencyKey } from "@/lib/integrations/tool-runs";
import { getToolDefinition } from "@/lib/integrations/registry/tool-definitions";
import { loadIntegrationEmployee } from "@/lib/integrations/load-employee";
import {
  isCapabilityGrantPayload,
  resolveCapabilityGrantApproval,
} from "@/lib/integrations/resolve-capability-grant";
import type { CapabilityGrantScope } from "@/lib/integrations/capability-grants";
import type { ToolCallResult, ToolPreview } from "@/lib/integrations/types";
import {
  insertHumanMessage,
  loadTopicContext,
  persistEmployeeEffects,
  type RoomContext,
} from "@/lib/server/room-messages";
import { ensureGeneralTopic } from "@/lib/server/topic-helpers";
import { processEmployeeResponse } from "@/lib/server/process-employee-response";
import type { ResolveCapabilityGrantResult } from "@/lib/integrations/resolve-capability-grant";
import { nowISO, uid } from "@/lib/utils";

async function persistCapabilityGrantAck(
  client: import("@supabase/supabase-js").SupabaseClient,
  ctx: RoomContext,
  resolved: ResolveCapabilityGrantResult,
): Promise<void> {
  const employee = ctx.employees.find((e) => e.id === resolved.employeeId);
  if (!employee) return;
  await persistEmployeeEffects(
    client,
    ctx.workspaceId,
    ctx.room.id,
    ctx.topic.id,
    employee,
    resolved.acknowledgment,
    { workLog: [], tasks: [], memory: [], approvals: [] },
  );
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ResolveAction = "approve" | "edit" | "reject" | "revise";

type ResolveBody = {
  action?: ResolveAction;
  note?: string;
  /** For "edit" — replacement args validated against the tool schema. */
  editedArgs?: Record<string, unknown>;
  /** For tool_access capability grants — Allow once vs Always allow. */
  grantScope?: CapabilityGrantScope;
};

type DbRow = Record<string, unknown>;

function approvalResponse(row: DbRow) {
  return {
    id: String(row.id),
    roomId: String(row.room_id),
    topicId: row.topic_id ? String(row.topic_id) : undefined,
    requestedBy: String(row.requested_by),
    title: String(row.title),
    description: String(row.description ?? ""),
    risk: row.risk,
    status: row.status,
    actionType: row.action_type,
    actionPayload: (row.action_payload as Record<string, unknown> | null) ?? undefined,
    previewSnapshot: (row.preview_snapshot as Record<string, unknown> | null) ?? undefined,
    revisionCount: Number(row.revision_count ?? 0),
    resolutionNote: row.resolution_note ? String(row.resolution_note) : undefined,
    executedToolRunId: row.executed_tool_run_id ? String(row.executed_tool_run_id) : undefined,
    createdAt: String(row.created_at ?? nowISO()),
    resolvedAt: row.resolved_at ? String(row.resolved_at) : undefined,
  };
}

async function writeResolutionWorkLog(
  client: import("@supabase/supabase-js").SupabaseClient,
  row: DbRow,
  workspaceId: string,
  params: { action: string; summary: string; status: "success" | "failed" },
): Promise<void> {
  const { error } = await client.from("work_log_events").insert({
    workspace_id: workspaceId,
    id: uid("wl"),
    room_id: String(row.room_id),
    topic_id: row.topic_id ?? null,
    employee_id: String(row.requested_by),
    action: params.action,
    summary: params.summary,
    status: params.status,
    related_entity_type: "approval",
    related_entity_id: String(row.id),
    created_at: nowISO(),
  });
  if (error) console.warn("[AdeHQ approvals resolve] work log failed", error);
}

export async function POST(
  request: NextRequest,
  { params }: { params: { approvalId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const body = (await request.json()) as ResolveBody;
    const action = body.action;

    if (!action || !["approve", "edit", "reject", "revise"].includes(action)) {
      return NextResponse.json(
        { error: "action must be approve, edit, reject, or revise." },
        { status: 400 },
      );
    }

    const { data: approvalRow, error: loadError } = await client
      .from("approvals")
      .select("*")
      .eq("id", params.approvalId)
      .maybeSingle();
    if (loadError) throw loadError;
    if (!approvalRow) {
      return NextResponse.json({ error: "Approval not found." }, { status: 404 });
    }

    const workspaceId = String((approvalRow as DbRow).workspace_id);
    const { role } = await requireWorkspaceMembership(client, workspaceId, user.id);

    const row = approvalRow as DbRow;
    const actionPayload = (row.action_payload as Record<string, unknown> | null) ?? null;
    const toolName = actionPayload?.tool ? String(actionPayload.tool) : null;
    const isCapabilityGrant =
      String(row.action_type) === "tool_access" && isCapabilityGrantPayload(actionPayload);

    // Capability grants (Allow once / Always) — any chat-capable member can answer.
    // Other approvals stay manager+.
    if (isCapabilityGrant) {
      if (!resolveHumanIntegrationPermissions(role).requestViaAi) {
        return NextResponse.json(
          { error: "Your workspace role cannot grant tool access." },
          { status: 403 },
        );
      }
      if (action === "revise" || action === "edit") {
        return NextResponse.json(
          { error: "Use Allow once, Always allow, or Not now for access requests." },
          { status: 400 },
        );
      }
      const scope: CapabilityGrantScope | "deny" =
        action === "reject"
          ? "deny"
          : body.grantScope === "always"
            ? "always"
            : "once";
      const resolved = await resolveCapabilityGrantApproval(client, {
        workspaceId,
        approvalId: params.approvalId,
        scope,
        resolvedByUserId: user.id,
        note: body.note,
      });
      if ("error" in resolved) {
        return NextResponse.json({ error: resolved.error }, { status: resolved.status });
      }

      // Conversational acknowledgment + continue the task after Allow once/Always.
      try {
        const roomId = String(row.room_id);
        const topicId = row.topic_id
          ? String(row.topic_id)
          : (await ensureGeneralTopic(client, workspaceId, roomId)).id;
        const ctx = await loadTopicContext(client, workspaceId, roomId, topicId);
        await persistCapabilityGrantAck(client, ctx, resolved);
        if (resolved.scope !== "deny") {
          const employee = ctx.employees.find((e) => e.id === resolved.employeeId);
          const triggerId =
            typeof actionPayload?.triggerMessageId === "string"
              ? actionPayload.triggerMessageId
              : null;
          if (employee && triggerId) {
            const { queueAgentRuns } = await import("@/lib/server/queue-agent-runs");
            const content = [
              `The human granted me ${resolved.scope === "always" ? "always-on" : "one-time"} access to ${resolved.domainLabel}.`,
              `Continue the previous request now that I can use ${resolved.toolName}.`,
            ].join(" ");
            await queueAgentRuns(client, {
              workspaceId,
              roomId,
              topicId,
              triggerMessageId: triggerId,
              responders: [{ employee, reason: "capability_grant_continue" }],
              content,
            });
          }
        }
      } catch (error) {
        console.warn("[AdeHQ approvals resolve] capability grant ack failed", error);
      }

      const { data: finalRow } = await client
        .from("approvals")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("id", params.approvalId)
        .maybeSingle();

      return NextResponse.json({
        approval: approvalResponse((finalRow as DbRow) ?? row),
        execution: resolved.execution,
        acknowledgment: resolved.acknowledgment,
      });
    }

    if (!canResolveApprovals(role)) {
      return NextResponse.json(
        { error: "Only owners, admins, and managers can resolve approvals." },
        { status: 403 },
      );
    }

    // -------------------------------------------------------------------
    // revise — keep it pending-ish: bump revision_count, note the feedback,
    // and ask the employee to redo the work in the original room/topic.
    // -------------------------------------------------------------------
    if (action === "revise") {
      const note = body.note?.trim();
      if (!note) {
        return NextResponse.json(
          { error: "Add a note describing what to change." },
          { status: 400 },
        );
      }

      const { data: updated, error: updateError } = await client
        .from("approvals")
        .update({
          status: "revision_requested",
          revision_count: Number(row.revision_count ?? 0) + 1,
          resolution_note: note,
          resolved_by: user.id,
          resolved_at: nowISO(),
        })
        .eq("workspace_id", workspaceId)
        .eq("id", params.approvalId)
        .eq("status", "pending")
        .select("*")
        .maybeSingle();
      if (updateError) throw updateError;
      if (!updated) {
        return NextResponse.json({ error: "Approval was already resolved." }, { status: 409 });
      }

      await writeResolutionWorkLog(client, row, workspaceId, {
        action: "approval_revision_requested",
        summary: `Revision requested: ${note.slice(0, 140)}`,
        status: "success",
      });

      // Ask the employee to revise — real AI turn in the original thread.
      let revisionReplyFailed: string | undefined;
      try {
        const roomId = String(row.room_id);
        const topicId = row.topic_id
          ? String(row.topic_id)
          : (await ensureGeneralTopic(client, workspaceId, roomId)).id;

        const { data: profile } = await client
          .from("profiles")
          .select("name")
          .eq("id", user.id)
          .maybeSingle();
        const userName = profile?.name ? String(profile.name) : "Teammate";

        const content = `I reviewed your request "${String(row.title)}" and I'd like a revision before approving: ${note}`;
        const humanMessage = await insertHumanMessage(
          client,
          workspaceId,
          roomId,
          { id: user.id, name: userName },
          content,
          topicId,
        );

        const ctx = await loadTopicContext(client, workspaceId, roomId, topicId);
        await processEmployeeResponse(client, ctx, String(row.requested_by), content, {
          triggerMessageId: humanMessage.id,
        });
      } catch (error) {
        console.warn("[AdeHQ approvals resolve] revision follow-up failed", error);
        revisionReplyFailed =
          "Revision recorded, but the employee could not respond right now.";
      }

      return NextResponse.json({
        approval: approvalResponse(updated as DbRow),
        revisionReplyFailed,
      });
    }

    // -------------------------------------------------------------------
    // reject
    // -------------------------------------------------------------------
    if (action === "reject") {
      const { data: updated, error: updateError } = await client
        .from("approvals")
        .update({
          status: "rejected",
          resolution_note: body.note?.trim() || null,
          resolved_by: user.id,
          resolved_at: nowISO(),
        })
        .eq("workspace_id", workspaceId)
        .eq("id", params.approvalId)
        .eq("status", "pending")
        .select("*")
        .maybeSingle();
      if (updateError) throw updateError;
      if (!updated) {
        return NextResponse.json({ error: "Approval was already resolved." }, { status: 409 });
      }

      await writeResolutionWorkLog(client, row, workspaceId, {
        action: "approval_rejected",
        summary: `Rejected: ${String(row.title)}`,
        status: "failed",
      });

      return NextResponse.json({ approval: approvalResponse(updated as DbRow) });
    }

    // -------------------------------------------------------------------
    // approve / edit (edit = approve with modified args)
    // -------------------------------------------------------------------
    let effectiveArgs = (actionPayload?.args as Record<string, unknown> | undefined) ?? {};
    let updatedPreview: (ToolPreview & { toolName: string }) | null = null;

    if (action === "edit") {
      if (!toolName) {
        return NextResponse.json(
          { error: "This approval has no editable action payload." },
          { status: 400 },
        );
      }
      const tool = getToolDefinition(toolName);
      if (!tool) {
        return NextResponse.json({ error: `Unknown tool "${toolName}".` }, { status: 400 });
      }
      const parsed = tool.argsSchema.safeParse(body.editedArgs ?? {});
      if (!parsed.success) {
        const issues = parsed.error.issues
          .map((i) => `${i.path.join(".") || "args"}: ${i.message}`)
          .join("; ");
        return NextResponse.json({ error: `Invalid edited values — ${issues}` }, { status: 400 });
      }
      effectiveArgs = parsed.data as Record<string, unknown>;
      updatedPreview = { ...tool.buildPreview(parsed.data), toolName: tool.name };

      // Persist email edits onto the inbox draft before send executes.
      if (toolName === "email.sendDraft") {
        const draftId =
          typeof effectiveArgs.draftId === "string" ? effectiveArgs.draftId.trim() : "";
        if (draftId) {
          const { data: draft } = await client
            .from("email_drafts")
            .select("id, current_version_id, status")
            .eq("workspace_id", workspaceId)
            .eq("id", draftId)
            .maybeSingle();
          if (draft?.current_version_id && draft.status === "draft") {
            const bodyText =
              (typeof effectiveArgs.body === "string" && effectiveArgs.body) ||
              (typeof effectiveArgs.bodyPreview === "string" && effectiveArgs.bodyPreview) ||
              "";
            const toRaw =
              typeof effectiveArgs.recipientEmail === "string"
                ? effectiveArgs.recipientEmail
                : "";
            const to = toRaw
              .split(/[,;]/)
              .map((v) => v.trim().toLowerCase())
              .filter(Boolean);
            const patch: Record<string, unknown> = {};
            if (typeof effectiveArgs.subject === "string") {
              patch.subject = effectiveArgs.subject;
            }
            if (to.length > 0) patch.to_addresses = to;
            if (bodyText) {
              const escaped = bodyText
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;");
              patch.text_body = bodyText;
              patch.html_body = escaped
                .split(/\n{2,}/)
                .map((para) => `<p>${para.replace(/\n/g, "<br/>")}</p>`)
                .join("");
            }
            if (Object.keys(patch).length > 0) {
              await client
                .from("email_draft_versions")
                .update(patch)
                .eq("id", draft.current_version_id);
            }
          }
        }
      }
    }

    // Atomic pending → approved flip is the idempotency gate for double-clicks.
    const approveUpdate: DbRow = {
      status: "approved",
      resolution_note: body.note?.trim() || null,
      resolved_by: user.id,
      resolved_at: nowISO(),
    };
    if (action === "edit" && actionPayload) {
      approveUpdate.action_payload = { ...actionPayload, args: effectiveArgs, edited: true };
      if (updatedPreview) approveUpdate.preview_snapshot = updatedPreview;
    }

    const { data: approved, error: approveError } = await client
      .from("approvals")
      .update(approveUpdate)
      .eq("workspace_id", workspaceId)
      .eq("id", params.approvalId)
      .eq("status", "pending")
      .select("*")
      .maybeSingle();
    if (approveError) throw approveError;
    if (!approved) {
      return NextResponse.json({ error: "Approval was already resolved." }, { status: 409 });
    }

    await writeResolutionWorkLog(client, row, workspaceId, {
      action: "approval_granted",
      summary: `Approved${action === "edit" ? " (with edits)" : ""}: ${String(row.title)}`,
      status: "success",
    });

    // Approving executes the action when there is a tool payload.
    let execution: ToolCallResult | undefined;
    if (toolName) {
      const employeeId = String(actionPayload?.employeeId ?? row.requested_by);
      const employee = await loadIntegrationEmployee(client, workspaceId, employeeId);
      if (!employee) {
        return NextResponse.json(
          { error: "The employee who requested this action no longer exists." },
          { status: 409 },
        );
      }

      execution = await runToolCall(
        client,
        {
          client,
          workspaceId,
          employeeId: employee.id,
          employeeName: employee.name,
          requestedByUserId: user.id,
          roomId: actionPayload?.roomId ? String(actionPayload.roomId) : String(row.room_id),
          topicId: actionPayload?.topicId
            ? String(actionPayload.topicId)
            : row.topic_id
              ? String(row.topic_id)
              : undefined,
        },
        {
          tool: toolName,
          mode: "execute",
          args: effectiveArgs,
          employeeId: employee.id,
          requestedByUserId: user.id,
          approvalId: params.approvalId,
          idempotencyKey: buildIdempotencyKey({
            scope: `approval:${params.approvalId}`,
            tool: toolName,
            args: effectiveArgs,
          }),
        },
        { employee, approvalVerified: true },
      );

      if (execution.status === "success" && execution.toolRunId) {
        await client
          .from("approvals")
          .update({ executed_tool_run_id: execution.toolRunId })
          .eq("workspace_id", workspaceId)
          .eq("id", params.approvalId);
      }
    }

    const { data: finalRow } = await client
      .from("approvals")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("id", params.approvalId)
      .maybeSingle();

    return NextResponse.json({
      approval: approvalResponse((finalRow as DbRow) ?? (approved as DbRow)),
      execution,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ approvals resolve]", error);
    return NextResponse.json({ error: "Unable to resolve approval." }, { status: 500 });
  }
}
