import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/admin/api-route";
import {
  assertPlatformAdminCanWrite,
  requirePlatformPermission,
} from "@/lib/admin/require-platform-admin";
import { writeAuditLog } from "@/lib/admin/audit";
import { invalidatePlatformFlagCache } from "@/lib/admin/platform-flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Maintenance toggles map to platform feature flags + a maintenance event record. */
const TOGGLES: Record<string, { flagKey: string; eventMode: string; invert?: boolean }> = {
  maintenance_mode: { flagKey: "maintenance_mode", eventMode: "maintenance" },
  signups_enabled: { flagKey: "signups_enabled", eventMode: "signups_disabled", invert: true },
  ai_runs_enabled: { flagKey: "ai_runs_enabled", eventMode: "ai_disabled", invert: true },
  browser_research_enabled: {
    flagKey: "browser_research_enabled",
    eventMode: "browser_disabled",
    invert: true,
  },
  file_uploads_enabled: {
    flagKey: "file_uploads_enabled",
    eventMode: "uploads_disabled",
    invert: true,
  },
};

export const GET = adminRoute(async (_request, { serviceClient }) => {
  const [flagsRes, eventsRes] = await Promise.all([
    serviceClient
      .from("platform_feature_flags")
      .select("key, value, updated_at")
      .eq("scope", "global")
      .in("key", [
        "maintenance_mode",
        "maintenance_message",
        "signups_enabled",
        "ai_runs_enabled",
        "browser_research_enabled",
        "file_uploads_enabled",
      ]),
    serviceClient
      .from("platform_maintenance_events")
      .select("id, mode, enabled, message, started_at, ended_at")
      .order("started_at", { ascending: false })
      .limit(20),
  ]);
  if (flagsRes.error) throw flagsRes.error;
  if (eventsRes.error) throw eventsRes.error;

  const flags: Record<string, unknown> = {};
  for (const row of flagsRes.data ?? []) flags[row.key] = row.value;

  return NextResponse.json({ flags, events: eventsRes.data ?? [] });
});

export const POST = adminRoute(async (request, ctx) => {
  assertPlatformAdminCanWrite(ctx.admin);
  requirePlatformPermission(ctx, "maintenance.write");

  const body = await request.json().catch(() => null);
  const toggleKey = typeof body?.toggle === "string" ? body.toggle : "";
  const enabled = body?.enabled;
  const message = typeof body?.message === "string" ? body.message : null;

  // Announcement message update (no boolean toggle).
  if (toggleKey === "maintenance_message") {
    const { error } = await ctx.serviceClient
      .from("platform_feature_flags")
      .update({
        value: JSON.parse(JSON.stringify(message ?? "")),
        updated_at: new Date().toISOString(),
        updated_by: ctx.admin.userId,
      })
      .eq("key", "maintenance_message")
      .eq("scope", "global");
    if (error) throw error;
    invalidatePlatformFlagCache();
    await writeAuditLog(ctx.serviceClient, {
      adminUserId: ctx.admin.userId,
      action: "maintenance_message_updated",
      targetType: "platform_feature_flag",
      targetId: "maintenance_message",
      after: { message },
      request,
    });
    return NextResponse.json({ ok: true });
  }

  const toggle = TOGGLES[toggleKey];
  if (!toggle || typeof enabled !== "boolean") {
    return NextResponse.json(
      { error: "toggle and enabled (boolean) are required." },
      { status: 400 },
    );
  }

  const { data: existing, error: readError } = await ctx.serviceClient
    .from("platform_feature_flags")
    .select("id, value")
    .eq("key", toggle.flagKey)
    .eq("scope", "global")
    .maybeSingle();
  if (readError) throw readError;
  if (!existing) {
    return NextResponse.json({ error: `Flag missing: ${toggle.flagKey}` }, { status: 404 });
  }

  const { error: updateError } = await ctx.serviceClient
    .from("platform_feature_flags")
    .update({
      value: enabled,
      updated_at: new Date().toISOString(),
      updated_by: ctx.admin.userId,
    })
    .eq("id", existing.id);
  if (updateError) throw updateError;

  invalidatePlatformFlagCache();

  // The maintenance event records when a restriction started/ended.
  const restrictionActive = toggle.invert ? !enabled : enabled;
  if (restrictionActive) {
    await ctx.serviceClient.from("platform_maintenance_events").insert({
      mode: toggle.eventMode,
      enabled: true,
      message,
      created_by: ctx.admin.userId,
    });
  } else {
    await ctx.serviceClient
      .from("platform_maintenance_events")
      .update({ enabled: false, ended_at: new Date().toISOString() })
      .eq("mode", toggle.eventMode)
      .eq("enabled", true);
  }

  await writeAuditLog(ctx.serviceClient, {
    adminUserId: ctx.admin.userId,
    action: "maintenance_toggle_changed",
    targetType: "platform_feature_flag",
    targetId: toggle.flagKey,
    before: { value: existing.value },
    after: { value: enabled },
    reason: typeof body?.reason === "string" ? body.reason : undefined,
    request,
  });

  return NextResponse.json({ ok: true, key: toggle.flagKey, value: enabled });
});
