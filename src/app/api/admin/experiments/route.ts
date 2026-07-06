import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/admin/api-route";
import {
  assertPlatformAdminCanWrite,
  requirePlatformPermission,
} from "@/lib/admin/require-platform-admin";
import { writeAuditLog } from "@/lib/admin/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = adminRoute(async (_request, { serviceClient }) => {
  const { data, error } = await serviceClient
    .from("platform_experiments")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return NextResponse.json({ experiments: data ?? [] });
});

export const POST = adminRoute(async (request, ctx) => {
  assertPlatformAdminCanWrite(ctx.admin);
  requirePlatformPermission(ctx, "flags.write");

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const description = typeof body?.description === "string" ? body.description : null;
  const variants = Array.isArray(body?.variants) ? body.variants : [];
  const status = typeof body?.status === "string" ? body.status : "draft";

  if (!name) {
    return NextResponse.json({ error: "name is required." }, { status: 400 });
  }

  const { data, error } = await ctx.serviceClient
    .from("platform_experiments")
    .insert({
      name,
      description,
      variants,
      status,
      created_by: ctx.admin.userId,
    })
    .select("*")
    .single();
  if (error) throw error;

  await writeAuditLog(ctx.serviceClient, {
    adminUserId: ctx.admin.userId,
    action: "experiment_created",
    targetType: "platform_experiment",
    targetId: data.id,
    after: data,
    request,
  });

  return NextResponse.json({ ok: true, experiment: data });
});
