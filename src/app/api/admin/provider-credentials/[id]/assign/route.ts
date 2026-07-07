import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/admin/api-route";
import { assertPlatformAdminCanWrite } from "@/lib/admin/require-platform-admin";
import { writeAuditLog } from "@/lib/admin/audit";
import { recordCredentialEvent } from "@/lib/providers/credentials/record-credential-event";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = adminRoute(async (request, { serviceClient, admin }) => {
  assertPlatformAdminCanWrite(admin);
  const parts = request.nextUrl.pathname.split("/");
  const id = parts[parts.indexOf("provider-credentials") + 1];
  const body = await request.json();
  const action = String(body.action ?? "assign");
  const workspaceId = String(body.workspaceId ?? "").trim();
  const provider = String(body.provider ?? "").trim();
  const reason = String(body.reason ?? "").trim();
  if (!workspaceId || !provider) {
    return NextResponse.json({ error: "workspaceId and provider are required." }, { status: 400 });
  }

  const patch: Record<string, unknown> = {
    workspace_id: workspaceId,
    provider,
    updated_at: new Date().toISOString(),
  };
  let auditAction = "provider_credential_assigned";
  if (action === "pause") {
    patch.status = "paused";
    patch.paused_reason = reason || "Paused by platform admin.";
    patch.paused_by = admin.userId;
    patch.paused_at = new Date().toISOString();
    auditAction = "provider_allocation_paused";
  } else if (action === "resume") {
    patch.status = "active";
    patch.paused_reason = null;
    patch.paused_by = null;
    patch.paused_at = null;
    auditAction = "provider_allocation_resumed";
  } else if (action === "revoke") {
    patch.status = "revoked";
    patch.credential_id = null;
    auditAction = "provider_credential_assigned";
  } else {
    patch.status = "active";
    patch.credential_id = id;
    patch.allocation_type = body.allocationType ?? "dedicated_key";
    patch.provider_project_id = body.providerProjectId ?? null;
    patch.created_by = admin.userId;
  }

  const { data, error } = await serviceClient
    .from("workspace_provider_allocations")
    .upsert(patch, { onConflict: "workspace_id,provider" })
    .select("*")
    .single();
  if (error) throw error;

  await recordCredentialEvent(serviceClient, {
    credentialId: action === "assign" ? id : null,
    workspaceId,
    provider,
    eventType: "assigned",
    reason,
    createdBy: admin.userId,
  });
  await writeAuditLog(serviceClient, {
    adminUserId: admin.userId,
    action: auditAction,
    targetType: "workspace_provider_allocation",
    targetId: String(data.id),
    after: data,
    reason,
    request,
  });

  return NextResponse.json({ allocation: data });
});
