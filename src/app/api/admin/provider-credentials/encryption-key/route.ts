import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { adminRoute } from "@/lib/admin/api-route";
import { assertSuperAdmin } from "@/lib/admin/require-platform-admin";
import { writeAuditLog } from "@/lib/admin/audit";
import {
  createVercelEnvVar,
  isVercelEnvConfigured,
  listVercelEnvVars,
} from "@/lib/admin/vercel/env-vars";
import { redeployLatestProduction, type RedeployResult } from "@/lib/admin/vercel/deploy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEY_NAME = "ADEHQ_SECRET_ENCRYPTION_KEY";
const VERSION_NAME = "ADEHQ_SECRET_ENCRYPTION_KEY_VERSION";
const FALLBACK_NAME = "ALLOW_PROVIDER_ENV_FALLBACK";
const ALL_TARGETS = ["production", "preview", "development"] as const;
// Vercel forbids "sensitive" env vars from targeting the development environment.
const SENSITIVE_TARGETS = ["production", "preview"] as const;

export const GET = adminRoute(async (_request, { admin }) => {
  assertSuperAdmin(admin);

  const runtimeConfigured = Boolean(process.env.ADEHQ_SECRET_ENCRYPTION_KEY?.trim());
  const manageable = isVercelEnvConfigured();

  let vercelConfigured = false;
  if (manageable) {
    try {
      const listed = await listVercelEnvVars();
      vercelConfigured = listed.envs.some((env) => env.key === KEY_NAME);
    } catch {
      // Non-fatal: fall back to runtime signal only.
    }
  }

  return NextResponse.json({ runtimeConfigured, vercelConfigured, manageable });
});

export const POST = adminRoute(async (request, { admin, serviceClient }) => {
  assertSuperAdmin(admin);

  if (!isVercelEnvConfigured()) {
    return NextResponse.json(
      { error: "Vercel API is not configured on this deployment. Set VERCEL_API_TOKEN to enable one-click generation." },
      { status: 400 },
    );
  }

  const body = await request.json().catch(() => null);
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (!reason) {
    return NextResponse.json({ error: "A reason is required for audit." }, { status: 400 });
  }

  let existingKeys: Set<string>;
  try {
    const listed = await listVercelEnvVars();
    existingKeys = new Set(listed.envs.map((env) => env.key));
  } catch (error) {
    return NextResponse.json(
      { error: `Could not read Vercel environment variables: ${error instanceof Error ? error.message : "unknown error"}` },
      { status: 502 },
    );
  }

  if (existingKeys.has(KEY_NAME)) {
    return NextResponse.json(
      {
        error: `${KEY_NAME} already exists in Vercel. Replacing it would orphan every encrypted credential — use the versioned rotation flow instead.`,
      },
      { status: 409 },
    );
  }

  // 32 random bytes, base64-encoded — decodes to exactly 32 bytes for AES-256-GCM.
  const key = randomBytes(32).toString("base64");

  try {
    await createVercelEnvVar({
      key: KEY_NAME,
      value: key,
      type: "sensitive",
      target: [...SENSITIVE_TARGETS],
      comment: "AdeHQ provider secret encryption master key (generated from AdeHQ Control).",
    });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to write ${KEY_NAME} to Vercel: ${error instanceof Error ? error.message : "unknown error"}` },
      { status: 502 },
    );
  }

  if (!existingKeys.has(VERSION_NAME)) {
    await createVercelEnvVar({
      key: VERSION_NAME,
      value: "1",
      type: "encrypted",
      target: [...ALL_TARGETS],
      comment: "AdeHQ secret encryption key version.",
    }).catch(() => {
      // Non-fatal: the version defaults to 1 in code when unset.
    });
  }

  if (!existingKeys.has(FALLBACK_NAME)) {
    await createVercelEnvVar({
      key: FALLBACK_NAME,
      value: "true",
      type: "encrypted",
      target: [...ALL_TARGETS],
      comment: "Allow env-var provider key fallback during migration.",
    }).catch(() => {
      // Non-fatal: fallback defaults to enabled in code when unset.
    });
  }

  let redeploy: RedeployResult;
  try {
    redeploy = await redeployLatestProduction({ action: "adehq-encryption-key" });
  } catch (error) {
    redeploy = {
      triggered: false,
      detail: error instanceof Error ? error.message : "Redeploy could not be triggered automatically.",
    };
  }

  await writeAuditLog(serviceClient, {
    adminUserId: admin.userId,
    action: "provider_encryption_key_generated",
    targetType: "vercel_env",
    targetId: KEY_NAME,
    after: { key: KEY_NAME, version: 1, redeployTriggered: redeploy.triggered },
    reason,
    request,
  });

  return NextResponse.json({
    ok: true,
    key,
    version: 1,
    redeploy,
    note: "Copy this key now — it is shown only once. It becomes active once the redeploy reaches READY.",
  });
});
