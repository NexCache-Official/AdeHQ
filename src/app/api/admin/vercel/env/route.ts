import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/admin/api-route";
import { assertSuperAdmin } from "@/lib/admin/require-platform-admin";
import { writeAuditLog } from "@/lib/admin/audit";
import {
  createVercelEnvVar,
  listVercelEnvVars,
  type UpsertVercelEnvInput,
} from "@/lib/admin/vercel/env-vars";
import type { VercelEnvTarget } from "@/lib/admin/vercel/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function auditSafeEnv(row: { id: string; key: string; type: string; target: string[] }) {
  return { id: row.id, key: row.key, type: row.type, target: row.target };
}

export const GET = adminRoute(async (_request, { admin }) => {
  assertSuperAdmin(admin);
  const result = await listVercelEnvVars();
  return NextResponse.json(result);
});

export const POST = adminRoute(async (request, { admin, serviceClient }) => {
  assertSuperAdmin(admin);

  const body = await request.json().catch(() => null);
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (!reason) {
    return NextResponse.json({ error: "A reason is required for audit." }, { status: 400 });
  }

  const key = typeof body?.key === "string" ? body.key : "";
  const value = typeof body?.value === "string" ? body.value : "";
  const target = Array.isArray(body?.target)
    ? (body.target.filter((t: string) =>
        ["production", "preview", "development"].includes(t),
      ) as VercelEnvTarget[])
    : (["production", "preview", "development"] as VercelEnvTarget[]);

  const input: UpsertVercelEnvInput = {
    key,
    value,
    target,
    type: body?.type === "plain" || body?.type === "encrypted" || body?.type === "sensitive"
      ? body.type
      : undefined,
    gitBranch: typeof body?.gitBranch === "string" ? body.gitBranch : null,
    comment: typeof body?.comment === "string" ? body.comment : null,
  };

  const created = await createVercelEnvVar(input);

  await writeAuditLog(serviceClient, {
    adminUserId: admin.userId,
    action: "vercel_env_created",
    targetType: "vercel_env",
    targetId: created.key,
    after: auditSafeEnv(created),
    reason,
    request,
  });

  return NextResponse.json({ ok: true, env: created });
});
