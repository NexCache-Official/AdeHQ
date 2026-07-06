import { NextRequest, NextResponse } from "next/server";
import { AuthError } from "@/lib/supabase/auth-server";
import {
  assertPlatformAdminCanWrite,
  requirePlatformAdmin,
} from "@/lib/admin/require-platform-admin";
import { writeAuditLog } from "@/lib/admin/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EDITABLE = new Set([
  "active",
  "description",
  "max_redemptions",
  "max_redemptions_per_user",
  "expires_at",
  "applies_to_plan",
  "extra_work_hours_per_week",
]);

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { serviceClient } = await requirePlatformAdmin(request);
    const { data, error } = await serviceClient
      .from("promo_code_redemptions")
      .select("id, user_id, workspace_id, redeemed_at")
      .eq("promo_code_id", params.id)
      .order("redeemed_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ redemptions: data ?? [] });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ Control] promo redemptions", error);
    return NextResponse.json({ error: "Failed to load redemptions." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { admin, serviceClient } = await requirePlatformAdmin(request);
    assertPlatformAdminCanWrite(admin);

    const body = await request.json().catch(() => null);
    const updates: Record<string, unknown> = {};
    if (body && typeof body.updates === "object" && body.updates) {
      for (const [key, value] of Object.entries(body.updates)) {
        if (EDITABLE.has(key)) updates[key] = value;
      }
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No editable fields provided." }, { status: 400 });
    }

    const { data, error } = await serviceClient
      .from("promo_codes")
      .update(updates)
      .eq("id", params.id)
      .select("*")
      .single();
    if (error) throw error;

    await writeAuditLog(serviceClient, {
      adminUserId: admin.userId,
      action: "promo_code_updated",
      targetType: "promo_code",
      targetId: params.id,
      after: data,
      request,
    });

    return NextResponse.json({ ok: true, promoCode: data });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ Control] promo update", error);
    return NextResponse.json({ error: "Failed to update promo code." }, { status: 500 });
  }
}
