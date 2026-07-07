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
  const replacementCredentialId = String(body.replacementCredentialId ?? "").trim();
  const reason = String(body.reason ?? "").trim();
  if (!replacementCredentialId) {
    return NextResponse.json({ error: "replacementCredentialId is required." }, { status: 400 });
  }

  const { data: replacement } = await serviceClient
    .from("platform_provider_credentials")
    .select("id, provider, status")
    .eq("id", replacementCredentialId)
    .maybeSingle();
  if (!replacement || replacement.status !== "active") {
    return NextResponse.json({ error: "Replacement credential must be active." }, { status: 400 });
  }

  const { data, error } = await serviceClient
    .from("platform_provider_credentials")
    .update({
      status: "rotating",
      replacement_credential_id: replacementCredentialId,
      rotated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("id, provider, status, replacement_credential_id")
    .single();
  if (error) throw error;

  if (body.moveAllocations === true) {
    await serviceClient
      .from("workspace_provider_allocations")
      .update({ credential_id: replacementCredentialId, allocation_type: "dedicated_key" })
      .eq("credential_id", id);
  }

  await recordCredentialEvent(serviceClient, {
    credentialId: id,
    provider: String(data.provider),
    eventType: "rotated",
    reason,
    metadata: { replacementCredentialId, moveAllocations: body.moveAllocations === true },
    createdBy: admin.userId,
  });
  await writeAuditLog(serviceClient, {
    adminUserId: admin.userId,
    action: body.moveAllocations === true ? "provider_credential_rotation_completed" : "provider_credential_rotation_started",
    targetType: "provider_credential",
    targetId: id,
    after: data,
    reason,
    request,
  });

  return NextResponse.json({ credential: data });
});
