import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/admin/api-route";
import {
  assertPlatformAdminCanWrite,
  requirePlatformPermission,
} from "@/lib/admin/require-platform-admin";
import { writeAuditLog } from "@/lib/admin/audit";
import { listIncidents } from "@/lib/admin/queries/incidents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = adminRoute(async (request, { serviceClient }) => {
  const status = request.nextUrl.searchParams.get("status");
  const incidents = await listIncidents(serviceClient, status);
  return NextResponse.json({ incidents });
});

export const POST = adminRoute(async (request, ctx) => {
  assertPlatformAdminCanWrite(ctx.admin);
  requirePlatformPermission(ctx, "incidents.write");

  const body = await request.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const incidentType = typeof body?.incidentType === "string" ? body.incidentType : "other";
  const severity = typeof body?.severity === "string" ? body.severity : "medium";
  const publicMessage = typeof body?.publicMessage === "string" ? body.publicMessage : null;
  const internalNotes = typeof body?.internalNotes === "string" ? body.internalNotes : null;
  const affectedSystems = Array.isArray(body?.affectedSystems) ? body.affectedSystems : [];

  if (!title) {
    return NextResponse.json({ error: "title is required." }, { status: 400 });
  }

  const { data, error } = await ctx.serviceClient
    .from("platform_incidents")
    .insert({
      title,
      incident_type: incidentType,
      severity,
      public_message: publicMessage,
      internal_notes: internalNotes,
      affected_systems: affectedSystems,
      created_by: ctx.admin.userId,
      owner_admin_id: ctx.admin.userId,
    })
    .select("*")
    .single();
  if (error) throw error;

  await writeAuditLog(ctx.serviceClient, {
    adminUserId: ctx.admin.userId,
    action: "incident_created",
    targetType: "platform_incident",
    targetId: data.id,
    after: data,
    reason: typeof body?.reason === "string" ? body.reason : undefined,
    request,
    severity: "high",
  });

  return NextResponse.json({ ok: true, incident: data });
});
