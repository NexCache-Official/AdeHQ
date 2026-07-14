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

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId") ?? undefined;
    const ctx = await resolveInboxRoute(request, workspaceId, "read");
    const { data, error } = await ctx.secret
      .from("email_rules")
      .select("id, name, is_active, priority, conditions, actions, mailbox_id, created_at")
      .eq("workspace_id", ctx.workspaceId)
      .order("priority", { ascending: true });
    if (error) throw error;
    return NextResponse.json({
      rules: (data ?? []).map((r) => ({
        id: String(r.id),
        name: String(r.name),
        isActive: Boolean(r.is_active),
        priority: Number(r.priority ?? 100),
        conditions: r.conditions ?? {},
        actions: r.actions ?? {},
        mailboxId: r.mailbox_id ? String(r.mailbox_id) : null,
      })),
    });
  } catch (error) {
    return inboxErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      workspaceId?: string;
      name?: string;
      priority?: number;
      conditions?: Record<string, unknown>;
      actions?: Record<string, unknown>;
      isActive?: boolean;
    };
    if (!body.name?.trim()) {
      return NextResponse.json({ error: "name required" }, { status: 400 });
    }
    const ctx = await resolveInboxRoute(request, body.workspaceId, "manage");
    assertCanManageRules(ctx.access);
    const { data, error } = await ctx.secret
      .from("email_rules")
      .insert({
        workspace_id: ctx.workspaceId,
        mailbox_id: ctx.mailbox.id,
        name: body.name.trim(),
        is_active: body.isActive !== false,
        priority: body.priority ?? 100,
        conditions: body.conditions ?? {},
        actions: body.actions ?? {},
      })
      .select("id, name, is_active, priority, conditions, actions")
      .single();
    if (error) throw error;
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
