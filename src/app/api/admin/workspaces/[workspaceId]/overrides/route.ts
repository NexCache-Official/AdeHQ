import { NextRequest, NextResponse } from "next/server";
import { AuthError } from "@/lib/supabase/auth-server";
import {
  assertPlatformAdminCanWrite,
  requirePlatformAdmin,
} from "@/lib/admin/require-platform-admin";
import { writeAuditLog } from "@/lib/admin/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "cancelled",
  "expired",
  "manual",
  "comped",
  "enterprise",
];

/**
 * Platform override actions for a workspace (super/billing admin only, all audited):
 *   - grant_work_hours: add a work-hours usage credit grant
 *   - set_plan_override: pin a plan (optionally with a work-hours override + expiry)
 *   - clear_plan_override: remove the pinned plan
 *   - set_subscription_status: mark comped/manual/enterprise/etc.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { workspaceId: string } },
) {
  try {
    const { admin, serviceClient } = await requirePlatformAdmin(request);
    assertPlatformAdminCanWrite(admin);

    const body = await request.json().catch(() => null);
    const action = typeof body?.action === "string" ? body.action : "";
    const reason = typeof body?.reason === "string" ? body.reason : undefined;
    const workspaceId = params.workspaceId;

    switch (action) {
      case "grant_work_hours": {
        const amount = Number(body?.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
          return NextResponse.json({ error: "A positive amount is required." }, { status: 400 });
        }
        const { data, error } = await serviceClient
          .from("usage_credit_grants")
          .insert({
            workspace_id: workspaceId,
            granted_by: admin.userId,
            credit_type: "work_hours",
            amount,
            reason: reason ?? null,
            expires_at: body?.expiresAt ?? null,
          })
          .select("*")
          .single();
        if (error) throw error;
        await writeAuditLog(serviceClient, {
          adminUserId: admin.userId,
          action: "workspace_work_hours_granted",
          targetType: "workspace",
          targetId: workspaceId,
          after: data,
          reason,
          request,
        });
        return NextResponse.json({ ok: true, grant: data });
      }

      case "set_plan_override": {
        const planSlug = typeof body?.planSlug === "string" ? body.planSlug.trim() : "";
        if (!planSlug) {
          return NextResponse.json({ error: "planSlug is required." }, { status: 400 });
        }
        const payload: Record<string, unknown> = {
          workspace_id: workspaceId,
          plan_slug: planSlug,
          reason: reason ?? null,
          expires_at: body?.expiresAt ?? null,
          created_by: admin.userId,
        };
        if (body?.weeklyWorkHoursOverride != null) {
          payload.weekly_ai_work_hours_override = Number(body.weeklyWorkHoursOverride);
        }
        const { data, error } = await serviceClient
          .from("workspace_plan_overrides")
          .upsert(payload, { onConflict: "workspace_id" })
          .select("*")
          .single();
        if (error) throw error;
        await writeAuditLog(serviceClient, {
          adminUserId: admin.userId,
          action: "workspace_plan_override_set",
          targetType: "workspace",
          targetId: workspaceId,
          after: data,
          reason,
          request,
        });
        return NextResponse.json({ ok: true, override: data });
      }

      case "clear_plan_override": {
        const { error } = await serviceClient
          .from("workspace_plan_overrides")
          .delete()
          .eq("workspace_id", workspaceId);
        if (error) throw error;
        await writeAuditLog(serviceClient, {
          adminUserId: admin.userId,
          action: "workspace_plan_override_cleared",
          targetType: "workspace",
          targetId: workspaceId,
          reason,
          request,
        });
        return NextResponse.json({ ok: true });
      }

      case "set_subscription_status": {
        const status = typeof body?.status === "string" ? body.status : "";
        const planSlug = typeof body?.planSlug === "string" ? body.planSlug.trim() : "";
        if (!SUBSCRIPTION_STATUSES.includes(status)) {
          return NextResponse.json({ error: "Invalid subscription status." }, { status: 400 });
        }
        const { data: existing } = await serviceClient
          .from("billing_subscriptions")
          .select("id, plan_slug")
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        let data;
        if (existing) {
          const res = await serviceClient
            .from("billing_subscriptions")
            .update({ status, ...(planSlug ? { plan_slug: planSlug } : {}) })
            .eq("id", existing.id)
            .select("*")
            .single();
          if (res.error) throw res.error;
          data = res.data;
        } else {
          const res = await serviceClient
            .from("billing_subscriptions")
            .insert({ workspace_id: workspaceId, plan_slug: planSlug || "free", status })
            .select("*")
            .single();
          if (res.error) throw res.error;
          data = res.data;
        }
        await writeAuditLog(serviceClient, {
          adminUserId: admin.userId,
          action: "workspace_subscription_status_changed",
          targetType: "workspace",
          targetId: workspaceId,
          after: data,
          reason,
          request,
        });
        return NextResponse.json({ ok: true, subscription: data });
      }

      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ Control] workspace overrides", error);
    return NextResponse.json({ error: "Override action failed." }, { status: 500 });
  }
}
