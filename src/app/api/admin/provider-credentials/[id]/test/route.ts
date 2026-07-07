import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/admin/api-route";
import { assertPlatformAdminCanWrite } from "@/lib/admin/require-platform-admin";
import { writeAuditLog } from "@/lib/admin/audit";
import { getSecret } from "@/lib/security/secrets/store";
import { recordCredentialEvent } from "@/lib/providers/credentials/record-credential-event";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function smokeTest(provider: string, apiKey: string): Promise<{ ok: boolean; detail: string }> {
  if (!apiKey.trim()) return { ok: false, detail: "Secret is empty." };
  if (provider === "siliconflow") {
    const res = await fetch(`${process.env.SILICONFLOW_API_BASE_URL ?? "https://api.siliconflow.com/v1"}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    return { ok: res.ok, detail: `SiliconFlow /models returned ${res.status}.` };
  }
  if (provider === "vercel_gateway") {
    const res = await fetch("https://ai-gateway.vercel.sh/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    return { ok: res.ok, detail: `Vercel Gateway /models returned ${res.status}.` };
  }
  if (provider === "tavily") {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: apiKey, query: "AdeHQ credential smoke test", max_results: 1 }),
    });
    return { ok: res.ok, detail: `Tavily search returned ${res.status}.` };
  }
  if (provider === "browserbase") {
    const res = await fetch("https://api.browserbase.com/v1/projects", {
      headers: { "x-bb-api-key": apiKey },
    });
    return { ok: res.ok, detail: `Browserbase projects returned ${res.status}.` };
  }
  return { ok: true, detail: "No live smoke configured for this platform provider." };
}

export const POST = adminRoute(async (request, { serviceClient, admin }) => {
  assertPlatformAdminCanWrite(admin);
  const parts = request.nextUrl.pathname.split("/");
  const id = parts[parts.indexOf("provider-credentials") + 1];
  const { data: row, error } = await serviceClient
    .from("platform_provider_credentials")
    .select("id, provider, secret_ref")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!row) return NextResponse.json({ error: "Credential not found." }, { status: 404 });

  const result = await smokeTest(String(row.provider), getSecret(String(row.secret_ref)));
  const patch = result.ok
    ? { status: "active", last_tested_at: new Date().toISOString(), last_success_at: new Date().toISOString() }
    : { status: "failed", last_tested_at: new Date().toISOString(), last_failure_at: new Date().toISOString() };
  await serviceClient.from("platform_provider_credentials").update(patch).eq("id", id);
  await recordCredentialEvent(serviceClient, {
    credentialId: id,
    provider: String(row.provider),
    eventType: result.ok ? "tested" : "failed",
    reason: result.detail,
    createdBy: admin.userId,
  });
  await writeAuditLog(serviceClient, {
    adminUserId: admin.userId,
    action: "provider_credential_tested",
    targetType: "provider_credential",
    targetId: id,
    after: { ok: result.ok, detail: result.detail },
    request,
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
});
