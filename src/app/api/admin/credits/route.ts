import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/admin/api-route";
import {
  assertPlatformAdminCanWrite,
  requirePlatformPermission,
} from "@/lib/admin/require-platform-admin";
import { writeAuditLog } from "@/lib/admin/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = adminRoute(async (request, ctx) => {
  requirePlatformPermission(ctx, "billing.read");

  const workspaceId = request.nextUrl.searchParams.get("workspaceId");

  let query = ctx.serviceClient
    .from("usage_credit_grants")
    .select("id, workspace_id, credit_type, amount, reason, expires_at, created_at, granted_by")
    .order("created_at", { ascending: false })
    .limit(50);

  if (workspaceId) query = query.eq("workspace_id", workspaceId);

  const { data, error } = await query;
  if (error) throw error;

  return NextResponse.json({ grants: data ?? [] });
});

export const POST = adminRoute(async (request, ctx) => {
  assertPlatformAdminCanWrite(ctx.admin);
  requirePlatformPermission(ctx, "billing.write");

  const body = await request.json().catch(() => null);
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId.trim() : "";
  const amount = Number(body?.amount);
  const creditType = typeof body?.creditType === "string" ? body.creditType : "work_hours";
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const expiresAt = typeof body?.expiresAt === "string" ? body.expiresAt : null;

  if (!workspaceId || !Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json(
      { error: "workspaceId and positive amount are required." },
      { status: 400 },
    );
  }
  if (!reason) {
    return NextResponse.json({ error: "reason is required for credit grants." }, { status: 400 });
  }

  const { data, error } = await ctx.serviceClient
    .from("usage_credit_grants")
    .insert({
      workspace_id: workspaceId,
      granted_by: ctx.admin.userId,
      credit_type: creditType,
      amount,
      reason,
      expires_at: expiresAt,
    })
    .select("*")
    .single();
  if (error) throw error;

  await writeAuditLog(ctx.serviceClient, {
    adminUserId: ctx.admin.userId,
    action: "credit_grant_created",
    targetType: "workspace",
    targetId: workspaceId,
    after: data,
    reason,
    request,
    severity: "medium",
  });

  return NextResponse.json({ ok: true, grant: data });
});
