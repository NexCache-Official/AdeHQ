import { NextRequest, NextResponse } from "next/server";
import {
  AuthError,
  requireAuthUser,
  requireWorkspaceMembership,
} from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { canManageAiEmployees } from "@/lib/workspace/permissions";
import { bumpMemberAccessVersion } from "@/lib/server/bump-access-version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GrantBody = {
  userId?: string;
  employeeId?: string;
  accessEffect?: "allow" | "deny";
  canDm?: boolean;
  canAssignWork?: boolean;
  canViewSharedOutputs?: boolean;
};

/** Upsert AI employee allow/deny grant for a workspace member. */
export async function PUT(
  request: NextRequest,
  { params }: { params: { workspaceId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const { role } = await requireWorkspaceMembership(client, params.workspaceId, user.id);
    if (!canManageAiEmployees(role)) {
      return NextResponse.json({ error: "Only admins can manage AI grants." }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as GrantBody;
    if (!body.userId || !body.employeeId || !body.accessEffect) {
      return NextResponse.json(
        { error: "userId, employeeId, and accessEffect are required." },
        { status: 400 },
      );
    }
    if (body.accessEffect !== "allow" && body.accessEffect !== "deny") {
      return NextResponse.json({ error: "accessEffect must be allow or deny." }, { status: 400 });
    }

    const service = createSupabaseSecretClient();
    const { data, error } = await service
      .from("ai_employee_user_grants")
      .upsert(
        {
          workspace_id: params.workspaceId,
          user_id: body.userId,
          employee_id: body.employeeId,
          access_effect: body.accessEffect,
          can_dm: body.canDm !== false,
          can_assign_work: body.canAssignWork !== false,
          can_view_shared_outputs: body.canViewSharedOutputs !== false,
          granted_by: user.id,
          granted_at: new Date().toISOString(),
        },
        { onConflict: "workspace_id,user_id,employee_id" },
      )
      .select("*")
      .single();
    if (error) throw error;

    await bumpMemberAccessVersion(service, params.workspaceId, body.userId);
    await service.from("access_audit_events").insert({
      workspace_id: params.workspaceId,
      actor_user_id: user.id,
      event_type: "ai_grant_upserted",
      payload: {
        userId: body.userId,
        employeeId: body.employeeId,
        accessEffect: body.accessEffect,
      },
    });

    return NextResponse.json({ ok: true, grant: data });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ ai-grants PUT]", error);
    return NextResponse.json({ error: "Unable to update AI grant." }, { status: 500 });
  }
}

/** Remove a grant (reverts to default workspace/restricted resolution). */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { workspaceId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const { role } = await requireWorkspaceMembership(client, params.workspaceId, user.id);
    if (!canManageAiEmployees(role)) {
      return NextResponse.json({ error: "Only admins can manage AI grants." }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as GrantBody;
    if (!body.userId || !body.employeeId) {
      return NextResponse.json({ error: "userId and employeeId are required." }, { status: 400 });
    }

    const service = createSupabaseSecretClient();
    const { error } = await service
      .from("ai_employee_user_grants")
      .delete()
      .eq("workspace_id", params.workspaceId)
      .eq("user_id", body.userId)
      .eq("employee_id", body.employeeId);
    if (error) throw error;

    await bumpMemberAccessVersion(service, params.workspaceId, body.userId);
    await service.from("access_audit_events").insert({
      workspace_id: params.workspaceId,
      actor_user_id: user.id,
      event_type: "ai_grant_removed",
      payload: { userId: body.userId, employeeId: body.employeeId },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ ai-grants DELETE]", error);
    return NextResponse.json({ error: "Unable to remove AI grant." }, { status: 500 });
  }
}
