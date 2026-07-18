import { NextRequest, NextResponse } from "next/server";
import {
  AuthError,
  requireAuthUser,
  requireWorkspaceMembership,
} from "@/lib/supabase/auth-server";
import { assertCanAccessRoom } from "@/lib/server/room-access";
import { resolveHumanIntegrationPermissions } from "@/lib/integrations/permissions";
import { loadIntegrationEmployee } from "@/lib/integrations/load-employee";
import {
  createRuntimeBrain,
  createSession,
  driveSession,
  getSession,
  listSteps,
} from "@/lib/autonomy";
import { loadWorkspaceAiSettings } from "@/lib/supabase/ai-runtime";
import { MAYA_EMPLOYEE_ID } from "@/lib/hiring/maya";
import { preloadPlatformFlags } from "@/lib/admin/platform-flags";
import type { WorkspaceMemberRole } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StartBody = {
  workspaceId?: string;
  employeeId?: string;
  objective?: string;
  roomId?: string;
  topicId?: string;
  taskId?: string;
  stepBudget?: number;
  costBudgetUsd?: number;
};

export async function POST(request: NextRequest) {
  try {
    const { user, client } = await requireAuthUser(request);
    const body = (await request.json()) as StartBody;

    if (!body.workspaceId || !body.employeeId || !body.objective?.trim()) {
      return NextResponse.json(
        { error: "workspaceId, employeeId, and objective are required." },
        { status: 400 },
      );
    }

    const { role } = await requireWorkspaceMembership(client, body.workspaceId, user.id);
    if (!resolveHumanIntegrationPermissions(role as WorkspaceMemberRole).requestViaAi) {
      return NextResponse.json(
        { error: "Your workspace role can't start autonomous work." },
        { status: 403 },
      );
    }
    if (body.roomId) {
      await assertCanAccessRoom(client, body.workspaceId, body.roomId, user.id, role);
    }

    await preloadPlatformFlags(client);

    const employee = await loadIntegrationEmployee(client, body.workspaceId, body.employeeId);
    if (!employee) {
      return NextResponse.json({ error: "Employee not found in workspace." }, { status: 404 });
    }
    if (employee.id === MAYA_EMPLOYEE_ID) {
      return NextResponse.json(
        { error: "Autopilot is for hired AI employees — Maya guides hiring instead." },
        { status: 400 },
      );
    }

    const settings = await loadWorkspaceAiSettings(client, body.workspaceId);
    const session = await createSession(client, {
      workspaceId: body.workspaceId,
      employeeId: body.employeeId,
      objective: body.objective,
      createdByUserId: user.id,
      roomId: body.roomId,
      topicId: body.topicId,
      taskId: body.taskId,
      stepBudget: body.stepBudget ?? settings.autonomyStepBudget,
      costBudgetUsd: body.costBudgetUsd ?? settings.autonomyCostBudgetUsd,
    });

    // Kick off processing in the background of this request; the GET poll
    // endpoint keeps driving it, so it completes even if this is cut short.
    const brain = createRuntimeBrain({ workspaceId: body.workspaceId, employeeId: body.employeeId });
    void driveSession(client, session.id, brain).catch((err) =>
      console.warn("[AdeHQ autonomy] inline drive failed", err),
    );

    const steps = await listSteps(client, session.id);
    return NextResponse.json({ session: (await getSession(client, session.id)) ?? session, steps });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ autonomy start]", error);
    return NextResponse.json({ error: "Could not start autonomous work." }, { status: 500 });
  }
}
