import { NextRequest, NextResponse } from "next/server";
import { AuthError } from "@/lib/supabase/auth-server";
import {
  assertPlatformAdminCanWrite,
  requirePlatformAdmin,
  requirePlatformPermission,
} from "@/lib/admin/require-platform-admin";
import { writeAuditLog } from "@/lib/admin/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STATUSES = ["open", "investigating", "mitigated", "resolved"];

export async function PATCH(
  request: NextRequest,
  { params }: { params: { incidentId: string } },
) {
  try {
    const ctx = await requirePlatformAdmin(request);
    assertPlatformAdminCanWrite(ctx.admin);
    requirePlatformPermission(ctx, "incidents.write");

    const body = await request.json().catch(() => null);
    const updates: Record<string, unknown> = {};

    if (typeof body?.status === "string" && VALID_STATUSES.includes(body.status)) {
      updates.status = body.status;
      if (body.status === "resolved") {
        updates.resolved_at = new Date().toISOString();
      }
    }
    if (typeof body?.severity === "string") updates.severity = body.severity;
    if (typeof body?.publicMessage === "string") updates.public_message = body.publicMessage;
    if (typeof body?.internalNotes === "string") updates.internal_notes = body.internalNotes;
    if (Array.isArray(body?.affectedSystems)) updates.affected_systems = body.affectedSystems;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
    }

    const { data: before, error: readError } = await ctx.serviceClient
      .from("platform_incidents")
      .select("*")
      .eq("id", params.incidentId)
      .maybeSingle();
    if (readError) throw readError;
    if (!before) {
      return NextResponse.json({ error: "Incident not found." }, { status: 404 });
    }

    const { data: after, error: updateError } = await ctx.serviceClient
      .from("platform_incidents")
      .update(updates)
      .eq("id", params.incidentId)
      .select("*")
      .single();
    if (updateError) throw updateError;

    await writeAuditLog(ctx.serviceClient, {
      adminUserId: ctx.admin.userId,
      action: "incident_updated",
      targetType: "platform_incident",
      targetId: params.incidentId,
      before,
      after,
      reason: typeof body?.reason === "string" ? body.reason : undefined,
      request,
      severity: "high",
    });

    return NextResponse.json({ ok: true, incident: after });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ Control] incident patch", error);
    return NextResponse.json({ error: "Incident update failed." }, { status: 500 });
  }
}
