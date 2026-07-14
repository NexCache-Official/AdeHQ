import { NextRequest, NextResponse } from "next/server";
import { resolveInboxRoute, inboxErrorResponse } from "@/lib/inbox/route-helpers";
import { AuthError } from "@/lib/supabase/auth-server";

export const runtime = "nodejs";

function assertCanManageRules(access: {
  canManage: boolean;
  isAdmin: boolean;
  permissions: string[];
}) {
  if (
    access.isAdmin ||
    access.canManage ||
    access.permissions.includes("email.manage_rules")
  ) {
    return;
  }
  throw new AuthError("Missing permission: email.manage_rules", 403);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ ruleId: string }> },
) {
  try {
    const { ruleId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      workspaceId?: string;
      name?: string;
      priority?: number;
      conditions?: Record<string, unknown>;
      actions?: Record<string, unknown>;
      isActive?: boolean;
    };
    const ctx = await resolveInboxRoute(request, body.workspaceId, "manage");
    assertCanManageRules(ctx.access);
    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (body.name?.trim()) patch.name = body.name.trim();
    if (typeof body.priority === "number") patch.priority = body.priority;
    if (body.conditions) patch.conditions = body.conditions;
    if (body.actions) patch.actions = body.actions;
    if (typeof body.isActive === "boolean") patch.is_active = body.isActive;

    const { data, error } = await ctx.secret
      .from("email_rules")
      .update(patch)
      .eq("workspace_id", ctx.workspaceId)
      .eq("id", ruleId)
      .select("id, name, is_active, priority, conditions, actions")
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({
      rule: {
        id: String(data.id),
        name: String(data.name),
        isActive: Boolean(data.is_active),
        priority: Number(data.priority ?? 100),
        conditions: data.conditions ?? {},
        actions: data.actions ?? {},
      },
    });
  } catch (error) {
    return inboxErrorResponse(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ ruleId: string }> },
) {
  try {
    const { ruleId } = await params;
    const workspaceId = request.nextUrl.searchParams.get("workspaceId") ?? undefined;
    const ctx = await resolveInboxRoute(request, workspaceId, "manage");
    assertCanManageRules(ctx.access);
    const { error } = await ctx.secret
      .from("email_rules")
      .delete()
      .eq("workspace_id", ctx.workspaceId)
      .eq("id", ruleId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return inboxErrorResponse(error);
  }
}
