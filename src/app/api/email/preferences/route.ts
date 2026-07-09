import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser } from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { getOrCreatePreferences, PREFERENCE_COLUMNS } from "@/lib/email/preferences";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function serialize(row: { product_updates: boolean; weekly_reports: boolean; activity_notifications: boolean } | null) {
  return {
    product_updates: row?.product_updates ?? true,
    weekly_reports: row?.weekly_reports ?? true,
    activity_notifications: row?.activity_notifications ?? true,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuthUser(request);
    const service = createSupabaseSecretClient();
    const row = await getOrCreatePreferences(user.email ?? "", {
      userId: user.id,
      client: service,
    });
    return NextResponse.json({ preferences: serialize(row) });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ email preferences GET]", error);
    return NextResponse.json({ error: "Unable to load preferences." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { user } = await requireAuthUser(request);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const update: Record<string, boolean> = {};
    for (const key of Object.keys(PREFERENCE_COLUMNS)) {
      if (typeof body[key] === "boolean") update[key] = body[key] as boolean;
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "No valid preferences provided." }, { status: 400 });
    }

    const service = createSupabaseSecretClient();
    // Ensure a row exists (defaults opted-in), then apply the toggle(s).
    await getOrCreatePreferences(user.email ?? "", { userId: user.id, client: service });
    const { data, error } = await service
      .from("email_preferences")
      .update(update)
      .eq("user_id", user.id)
      .select("product_updates, weekly_reports, activity_notifications")
      .single();

    if (error) throw error;
    return NextResponse.json({ preferences: serialize(data) });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ email preferences PATCH]", error);
    return NextResponse.json({ error: "Unable to update preferences." }, { status: 500 });
  }
}
