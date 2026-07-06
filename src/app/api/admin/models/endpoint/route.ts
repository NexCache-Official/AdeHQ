import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/admin/api-route";
import { assertPlatformAdminCanWrite } from "@/lib/admin/require-platform-admin";
import { writeAuditLog } from "@/lib/admin/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH — enable/disable a model catalog endpoint by endpoint_key. */
export const PATCH = adminRoute(async (request, { admin, serviceClient }) => {
  assertPlatformAdminCanWrite(admin);

  const body = await request.json().catch(() => null);
  const endpointKey = typeof body?.endpointKey === "string" ? body.endpointKey.trim() : "";
  if (!endpointKey || typeof body?.enabled !== "boolean") {
    return NextResponse.json(
      { error: "endpointKey and enabled (boolean) are required." },
      { status: 400 },
    );
  }

  const { data: before, error: readError } = await serviceClient
    .from("ai_model_catalog")
    .select("endpoint_key, provider_route, model_id, enabled")
    .eq("endpoint_key", endpointKey)
    .maybeSingle();
  if (readError) throw readError;
  if (!before) {
    return NextResponse.json({ error: "Endpoint not found." }, { status: 404 });
  }

  const { data: after, error: updateError } = await serviceClient
    .from("ai_model_catalog")
    .update({ enabled: body.enabled, updated_at: new Date().toISOString() })
    .eq("endpoint_key", endpointKey)
    .select("endpoint_key, provider_route, model_id, enabled")
    .single();
  if (updateError) throw updateError;

  await writeAuditLog(serviceClient, {
    adminUserId: admin.userId,
    action: body.enabled ? "model_endpoint_enabled" : "model_endpoint_disabled",
    targetType: "ai_model_catalog",
    targetId: endpointKey,
    before,
    after,
    reason: typeof body?.reason === "string" ? body.reason : undefined,
    request,
  });

  return NextResponse.json({ ok: true, endpoint: after });
});
