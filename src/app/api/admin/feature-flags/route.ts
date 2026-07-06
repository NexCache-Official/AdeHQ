import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/admin/api-route";
import { assertPlatformAdminCanWrite, requirePlatformPermission } from "@/lib/admin/require-platform-admin";
import { writeAuditLog } from "@/lib/admin/audit";
import { invalidatePlatformFlagCache } from "@/lib/admin/platform-flags";
import { getRuntimeFlags } from "@/lib/ai/runtime/flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = adminRoute(async (_request, { serviceClient }) => {
  const { data, error } = await serviceClient
    .from("platform_feature_flags")
    .select("id, key, value, flag_type, scope, scope_id, description, updated_at")
    .order("key");
  if (error) throw error;

  return NextResponse.json({
    flags: (data ?? []).map((row) => ({
      id: row.id,
      key: row.key,
      value: row.value,
      flagType: row.flag_type,
      scope: row.scope,
      scopeId: row.scope_id,
      description: row.description,
      updatedAt: row.updated_at,
    })),
    runtimeEnvFlags: getRuntimeFlags(),
  });
});

export const PUT = adminRoute(async (request, ctx) => {
  assertPlatformAdminCanWrite(ctx.admin);
  requirePlatformPermission(ctx, "flags.write");

  const body = await request.json().catch(() => null);
  const key = typeof body?.key === "string" ? body.key.trim() : "";
  if (!key || body?.value === undefined) {
    return NextResponse.json({ error: "key and value are required." }, { status: 400 });
  }

  const { data: existing, error: readError } = await ctx.serviceClient
    .from("platform_feature_flags")
    .select("id, key, value")
    .eq("key", key)
    .eq("scope", "global")
    .maybeSingle();
  if (readError) throw readError;
  if (!existing) {
    return NextResponse.json({ error: `Unknown flag: ${key}` }, { status: 404 });
  }

  const { error: updateError } = await ctx.serviceClient
    .from("platform_feature_flags")
    .update({ value: body.value, updated_at: new Date().toISOString(), updated_by: ctx.admin.userId })
    .eq("id", existing.id);
  if (updateError) throw updateError;

  invalidatePlatformFlagCache();

  await writeAuditLog(ctx.serviceClient, {
    adminUserId: ctx.admin.userId,
    action: "feature_flag_updated",
    targetType: "platform_feature_flag",
    targetId: key,
    before: { value: existing.value },
    after: { value: body.value },
    reason: typeof body?.reason === "string" ? body.reason : undefined,
    request,
  });

  return NextResponse.json({ ok: true, key, value: body.value });
});
