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
import { loadIntegrationEmployee } from "@/lib/integrations/load-employee";
import { getToolDefinition } from "@/lib/integrations/registry/tool-definitions";
import type { ToolCallMode } from "@/lib/integrations/types";
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
  approvalId?: string;
  idempotencyKey?: string;
};

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

    const employee = await loadIntegrationEmployee(client, body.workspaceId, body.employeeId);
    if (!employee) {
      return NextResponse.json({ error: "Employee not found in workspace." }, { status: 404 });
    }

    const employeeWithGrants = await ensureDefaultEmployeeToolGrants(
      client,
      body.workspaceId,
      employee,
    );

    const result = await runToolCall(
      client,
      {
        client,
        workspaceId: body.workspaceId,
        employeeId: employee.id,
        employeeName: employee.name,
        requestedByUserId: user.id,
        requestedByRole: role as WorkspaceMemberRole,
        roomId: body.roomId,
        topicId: body.topicId,
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
