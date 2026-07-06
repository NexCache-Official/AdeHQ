import { NextRequest, NextResponse } from "next/server";
import { AuthError } from "@/lib/supabase/auth-server";
import { assertSuperAdmin, requirePlatformAdmin } from "@/lib/admin/require-platform-admin";
import { writeAuditLog } from "@/lib/admin/audit";
import {
  assertEnvMutable,
  deleteVercelEnvVar,
  listVercelEnvVars,
  PROTECTED_ENV_KEYS,
  updateVercelEnvVar,
} from "@/lib/admin/vercel/env-vars";
import type { VercelEnvTarget } from "@/lib/admin/vercel/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function auditSafeEnv(row: { id: string; key: string; type: string; target: string[] }) {
  return { id: row.id, key: row.key, type: row.type, target: row.target };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { envId: string } },
) {
  try {
    const { admin, serviceClient } = await requirePlatformAdmin(request);
    assertSuperAdmin(admin);

    const body = await request.json().catch(() => null);
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
    if (!reason) {
      return NextResponse.json({ error: "A reason is required for audit." }, { status: 400 });
    }

    const listed = await listVercelEnvVars();
    const existing = listed.envs.find((e) => e.id === params.envId);
    if (!existing) {
      return NextResponse.json({ error: "Environment variable not found." }, { status: 404 });
    }
    assertEnvMutable(existing);

    const target = Array.isArray(body?.target)
      ? (body.target.filter((t: string) =>
          ["production", "preview", "development"].includes(t),
        ) as VercelEnvTarget[])
      : undefined;

    const updated = await updateVercelEnvVar(params.envId, {
      key: typeof body?.key === "string" ? body.key : undefined,
      value: typeof body?.value === "string" ? body.value : undefined,
      type: body?.type === "plain" || body?.type === "encrypted" || body?.type === "sensitive"
        ? body.type
        : undefined,
      target,
      gitBranch: body?.gitBranch !== undefined ? body.gitBranch : undefined,
      comment: body?.comment !== undefined ? body.comment : undefined,
    });

    await writeAuditLog(serviceClient, {
      adminUserId: admin.userId,
      action: "vercel_env_updated",
      targetType: "vercel_env",
      targetId: updated.key,
      before: auditSafeEnv(existing),
      after: auditSafeEnv(updated),
      reason,
      request,
    });

    return NextResponse.json({ ok: true, env: updated });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ Control] vercel env PATCH", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Update failed." },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { envId: string } },
) {
  try {
    const { admin, serviceClient } = await requirePlatformAdmin(request);
    assertSuperAdmin(admin);

    const body = await request.json().catch(() => ({})) as {
      reason?: string;
      confirmKey?: string;
    };
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    const confirmKey = typeof body.confirmKey === "string" ? body.confirmKey.trim() : "";
    if (!reason) {
      return NextResponse.json({ error: "A reason is required for audit." }, { status: 400 });
    }

    const listed = await listVercelEnvVars();
    const existing = listed.envs.find((e) => e.id === params.envId);
    if (!existing) {
      return NextResponse.json({ error: "Environment variable not found." }, { status: 404 });
    }
    assertEnvMutable(existing);

    if (PROTECTED_ENV_KEYS.has(existing.key) && confirmKey !== existing.key) {
      return NextResponse.json(
        {
          error: `Type the key name "${existing.key}" to confirm deletion of this protected variable.`,
        },
        { status: 400 },
      );
    }

    await deleteVercelEnvVar(params.envId);

    await writeAuditLog(serviceClient, {
      adminUserId: admin.userId,
      action: "vercel_env_deleted",
      targetType: "vercel_env",
      targetId: existing.key,
      before: auditSafeEnv(existing),
      reason,
      request,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ Control] vercel env DELETE", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Delete failed." },
      { status: 500 },
    );
  }
}
