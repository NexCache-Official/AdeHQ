import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/admin/api-route";
import { assertPlatformAdminCanWrite, assertSuperAdmin } from "@/lib/admin/require-platform-admin";
import { writeAuditLog } from "@/lib/admin/audit";
import { recordCredentialEvent } from "@/lib/providers/credentials/record-credential-event";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const PATCH = adminRoute(async (request, { serviceClient, admin }) => {
  assertPlatformAdminCanWrite(admin);
  const id = request.nextUrl.pathname.split("/").at(-1)!;
  const body = await request.json();
  const action = String(body.action ?? "update");
  const reason = String(body.reason ?? "").trim();

  const { data: before, error: loadError } = await serviceClient
    .from("platform_provider_credentials")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (loadError) throw loadError;
  if (!before) return NextResponse.json({ error: "Credential not found." }, { status: 404 });

  const patch: Record<string, unknown> = {};
  let auditAction = "provider_credential_disabled";
  let eventType: "disabled" | "revoked" | "tested" | "updated" = "disabled";

  if (action === "disable") {
    patch.status = "disabled";
    auditAction = "provider_credential_disabled";
    eventType = "disabled";
  } else if (action === "revoke") {
    patch.status = "revoked";
    auditAction = "provider_credential_revoked";
    eventType = "revoked";
  } else if (action === "activate") {
    assertSuperAdmin(admin);
    patch.status = "active";
    auditAction = "provider_credential_activated";
    eventType = "tested";
  } else if (action === "update") {
    patch.daily_limit_usd = body.dailyLimitUsd ?? null;
    patch.daily_limit_requests = body.dailyLimitRequests ?? null;
    patch.monthly_limit_usd = body.monthlyLimitUsd ?? null;
    patch.monthly_limit_requests = body.monthlyLimitRequests ?? null;
    auditAction = "provider_credential_updated";
    eventType = "updated";
  } else {
    return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
  }

  const { data, error } = await serviceClient
    .from("platform_provider_credentials")
    .update(patch)
    .eq("id", id)
    .select("id, provider, label, scope, status")
    .single();
  if (error) throw error;

  await recordCredentialEvent(serviceClient, {
    credentialId: id,
    provider: String(before.provider),
    eventType,
    reason,
    createdBy: admin.userId,
  });
  await writeAuditLog(serviceClient, {
    adminUserId: admin.userId,
    action: auditAction,
    targetType: "provider_credential",
    targetId: id,
    before,
    after: data,
    reason,
    request,
  });

  return NextResponse.json({ credential: data });
});
