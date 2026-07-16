import { NextRequest, NextResponse } from "next/server";
import {
  AuthError,
  requireAuthUser,
  requireWorkspaceMembership,
} from "@/lib/supabase/auth-server";
import { assertCanAccessRoom } from "@/lib/server/room-access";
import { runToolCall } from "@/lib/integrations/executor/tool-executor";
import {
  ensureDefaultEmployeeToolGrants,
  resolveHumanIntegrationPermissions,
} from "@/lib/integrations/permissions";
import {
  loadActiveSessionGrantToolIds,
  withSessionGrantsOnEmployee,
} from "@/lib/integrations/capability-grants";
import { loadIntegrationEmployee } from "@/lib/integrations/load-employee";
import { getToolDefinition } from "@/lib/integrations/registry/tool-definitions";
import type { ToolCallMode } from "@/lib/integrations/types";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import type { WorkspaceMemberRole } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RunToolBody = {
  workspaceId?: string;
  employeeId?: string;
  tool?: string;
  mode?: ToolCallMode;
  args?: Record<string, unknown>;
  roomId?: string;
  topicId?: string;
  triggerMessageId?: string;
  approvalId?: string;
  idempotencyKey?: string;
};

async function loadTriggerMessageText(
  client: Awaited<ReturnType<typeof requireAuthUser>>["client"],
  workspaceId: string,
  triggerMessageId?: string,
): Promise<string | undefined> {
  if (!triggerMessageId) return undefined;
  const { data, error } = await client
    .from("messages")
    .select("content")
    .eq("workspace_id", workspaceId)
    .eq("id", triggerMessageId)
    .maybeSingle();
  if (error) {
    console.warn("[AdeHQ integrations tools/run] trigger message fetch failed", error);
    return undefined;
  }
  return data?.content ? String(data.content) : undefined;
}

export async function POST(request: NextRequest) {
  try {
    const { user, client } = await requireAuthUser(request);
    const body = (await request.json()) as RunToolBody;

    if (!body.workspaceId || !body.employeeId || !body.tool) {
      return NextResponse.json(
        { error: "workspaceId, employeeId, and tool are required." },
        { status: 400 },
      );
    }

    if (!getToolDefinition(body.tool)) {
      return NextResponse.json({ error: `Unknown tool "${body.tool}".` }, { status: 400 });
    }

    const { role } = await requireWorkspaceMembership(client, body.workspaceId, user.id);
    const humanPermissions = resolveHumanIntegrationPermissions(role);
    if (!humanPermissions.requestViaAi) {
      return NextResponse.json(
        { error: "Your workspace role does not allow triggering employee tools." },
        { status: 403 },
      );
    }

    if (body.roomId) {
      await assertCanAccessRoom(client, body.workspaceId, body.roomId, user.id, role);
    }

    // Service role for tool writes (outbox, drafts, CRM) after auth gates above.
    const service = createSupabaseSecretClient();
    const employee = await loadIntegrationEmployee(service, body.workspaceId, body.employeeId);
    if (!employee) {
      return NextResponse.json({ error: "Employee not found in workspace." }, { status: 404 });
    }

    const seeded = await ensureDefaultEmployeeToolGrants(
      service,
      body.workspaceId,
      employee,
    );
    const sessionIds = await loadActiveSessionGrantToolIds(service, {
      workspaceId: body.workspaceId,
      employeeId: seeded.id,
      roomId: body.roomId,
    });
    const employeeWithGrants = withSessionGrantsOnEmployee(seeded, sessionIds);
    const triggerMessageText = await loadTriggerMessageText(
      client,
      body.workspaceId,
      body.triggerMessageId,
    );

    const result = await runToolCall(
      service,
      {
        client: service,
        workspaceId: body.workspaceId,
        employeeId: employee.id,
        employeeName: employee.name,
        requestedByUserId: user.id,
        requestedByRole: role as WorkspaceMemberRole,
        roomId: body.roomId,
        topicId: body.topicId,
        triggerMessageId: body.triggerMessageId,
        triggerMessageText,
      },
      {
        tool: body.tool,
        mode: body.mode === "preview" ? "preview" : "execute",
        args: body.args ?? {},
        employeeId: employee.id,
        requestedByUserId: user.id,
        approvalId: body.approvalId,
        idempotencyKey: body.idempotencyKey,
      },
      { employee: employeeWithGrants },
    );

    return NextResponse.json({ result });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ integrations tools/run]", error);
    return NextResponse.json({ error: "Tool call failed. Try again." }, { status: 500 });
  }
}
