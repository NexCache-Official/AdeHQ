import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/admin/api-route";
import { assertPlatformAdminCanWrite } from "@/lib/admin/require-platform-admin";
import { writeAuditLog } from "@/lib/admin/audit";
import { getProviderCredentialsSummary } from "@/lib/admin/queries/provider-credentials";
import { putSecret } from "@/lib/security/secrets/store";
import { recordCredentialEvent } from "@/lib/providers/credentials/record-credential-event";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = adminRoute(async (_request, { serviceClient }) => {
  return NextResponse.json(await getProviderCredentialsSummary(serviceClient));
});

export const POST = adminRoute(async (request, { serviceClient, admin }) => {
  assertPlatformAdminCanWrite(admin);
  const body = await request.json();
  const provider = String(body.provider ?? "").trim();
  const label = String(body.label ?? "").trim();
  const plaintext = String(body.apiKey ?? body.secret ?? "").trim();
  const reason = String(body.reason ?? "").trim();
  if (!provider || !label || !plaintext) {
    return NextResponse.json({ error: "provider, label, and apiKey are required." }, { status: 400 });
  }

  const secret = putSecret(plaintext);
  const { data: duplicate } = await serviceClient
    .from("platform_provider_credentials")
    .select("id")
    .eq("provider", provider)
    .eq("key_fingerprint_sha256", secret.fingerprint)
    .neq("status", "revoked")
    .limit(1)
    .maybeSingle();
  if (duplicate) {
    return NextResponse.json({ error: "A non-revoked credential with this fingerprint already exists." }, { status: 409 });
  }

  const { data, error } = await serviceClient
    .from("platform_provider_credentials")
    .insert({
      provider,
      label,
      scope: body.scope ?? "global_pool",
      secret_ref: secret.secretRef,
      key_last4: secret.last4,
      key_fingerprint_sha256: secret.fingerprint,
      encryption_key_version: secret.keyVersion,
      status: "untested",
      daily_limit_usd: body.dailyLimitUsd ?? null,
      daily_limit_requests: body.dailyLimitRequests ?? null,
      monthly_limit_usd: body.monthlyLimitUsd ?? null,
      monthly_limit_requests: body.monthlyLimitRequests ?? null,
      created_by: admin.userId,
      metadata: body.metadata ?? {},
    })
    .select("id, provider, label, scope, status, key_last4, key_fingerprint_sha256")
    .single();
  if (error) throw error;

  await recordCredentialEvent(serviceClient, {
    credentialId: String(data.id),
    provider,
    eventType: "created",
    reason,
    createdBy: admin.userId,
  });
  await writeAuditLog(serviceClient, {
    adminUserId: admin.userId,
    action: "provider_credential_created",
    targetType: "provider_credential",
    targetId: String(data.id),
    after: { provider, label, scope: body.scope ?? "global_pool", status: "untested" },
    reason,
    request,
  });

  return NextResponse.json({ credential: data }, { status: 201 });
});
