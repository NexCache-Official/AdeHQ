import { NextRequest, NextResponse } from "next/server";
import { AuthError } from "@/lib/supabase/auth-server";
import {
  assertPlatformAdminCanWrite,
  requirePlatformAdmin,
} from "@/lib/admin/require-platform-admin";
import { writeAuditLog } from "@/lib/admin/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STATUSES = ["active", "disabled", "test"];

export async function PATCH(
  request: NextRequest,
  { params }: { params: { workspaceId: string } },
) {
  try {
    const { admin, serviceClient } = await requirePlatformAdmin(request);
    assertPlatformAdminCanWrite(admin);

    const body = await request.json().catch(() => null);
    const updates: Record<string, unknown> = {};

    if (typeof body?.status === "string") {
      if (!VALID_STATUSES.includes(body.status)) {
        return NextResponse.json({ error: "Invalid status." }, { status: 400 });
      }
      updates.status = body.status;
    }
    if (typeof body?.plan === "string" && body.plan.trim()) {
      updates.plan = body.plan.trim();
      // Keep the unified plan_slug in sync so the entitlement resolver picks it up.
      updates.plan_slug = body.plan.trim();
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "Provide status and/or plan to update." },
        { status: 400 },
      );
    }

    const { data: before, error: readError } = await serviceClient
      .from("workspaces")
      .select("id, name, status, plan, plan_slug")
      .eq("id", params.workspaceId)
      .maybeSingle();
    if (readError) throw readError;
    if (!before) {
      return NextResponse.json({ error: "Workspace not found." }, { status: 404 });
    }

    const { data: after, error: updateError } = await serviceClient
      .from("workspaces")
      .update(updates)
      .eq("id", params.workspaceId)
      .select("id, name, status, plan, plan_slug")
      .single();
    if (updateError) throw updateError;

    await writeAuditLog(serviceClient, {
      adminUserId: admin.userId,
      action: updates.status ? "workspace_status_changed" : "workspace_plan_changed",
      targetType: "workspace",
      targetId: params.workspaceId,
      before,
      after,
      reason: typeof body?.reason === "string" ? body.reason : undefined,
      request,
    });

    return NextResponse.json({ ok: true, workspace: after });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ Control] workspace patch", error);
    return NextResponse.json({ error: "Workspace update failed." }, { status: 500 });
  }
}
