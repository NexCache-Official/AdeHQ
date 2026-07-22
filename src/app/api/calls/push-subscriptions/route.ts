import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  AuthError,
  getRequestWorkspaceId,
  requireAuthUser,
  requireWorkspaceMembership,
} from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { sendTestCallPush } from "@/lib/calls";
import { uid } from "@/lib/utils";

const schema = z.object({
  deviceId: z.string().min(4).max(200),
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
  userAgent: z.string().max(1000).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const { user, client } = await requireAuthUser(request);
    const workspaceId = getRequestWorkspaceId(request);
    if (!workspaceId) throw new AuthError("workspaceId required.", 400);
    await requireWorkspaceMembership(client, workspaceId, user.id);
    const { data, error } = await createSupabaseSecretClient()
      .from("push_subscriptions")
      .select("device_id, enabled, last_success_at, last_failure_at, updated_at")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });
    if (error) throw error;
    const enabled = (data ?? []).filter((subscription) => subscription.enabled);
    return NextResponse.json({
      configured: Boolean(
        process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() &&
          process.env.VAPID_PRIVATE_KEY?.trim(),
      ),
      enabledDevices: enabled.length,
      lastSuccessAt: enabled.find((subscription) => subscription.last_success_at)
        ?.last_success_at ?? null,
      lastFailureAt: enabled.find((subscription) => subscription.last_failure_at)
        ?.last_failure_at ?? null,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Could not read notification health." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, client } = await requireAuthUser(request);
    const workspaceId = getRequestWorkspaceId(request);
    if (!workspaceId) throw new AuthError("workspaceId required.", 400);
    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new AuthError("Invalid push subscription.", 400);
    await requireWorkspaceMembership(client, workspaceId, user.id);
    const { error } = await createSupabaseSecretClient().from("push_subscriptions").upsert(
      {
        workspace_id: workspaceId,
        id: uid("push"),
        user_id: user.id,
        device_id: parsed.data.deviceId,
        endpoint: parsed.data.endpoint,
        p256dh: parsed.data.keys.p256dh,
        auth: parsed.data.keys.auth,
        user_agent: parsed.data.userAgent ?? null,
        enabled: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,endpoint" },
    );
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Could not save notification settings." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { user, client } = await requireAuthUser(request);
    const workspaceId = getRequestWorkspaceId(request);
    if (!workspaceId) throw new AuthError("workspaceId required.", 400);
    const endpoint = request.nextUrl.searchParams.get("endpoint");
    if (!endpoint) throw new AuthError("endpoint required.", 400);
    await requireWorkspaceMembership(client, workspaceId, user.id);
    const { error } = await createSupabaseSecretClient()
      .from("push_subscriptions")
      .update({ enabled: false, updated_at: new Date().toISOString() })
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .eq("endpoint", endpoint);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Could not disable notifications." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { user, client } = await requireAuthUser(request);
    const workspaceId = getRequestWorkspaceId(request);
    if (!workspaceId) throw new AuthError("workspaceId required.", 400);
    await requireWorkspaceMembership(client, workspaceId, user.id);
    const result = await sendTestCallPush(createSupabaseSecretClient(), {
      workspaceId,
      userId: user.id,
    });
    if (!result.configured) {
      throw new AuthError("Call notifications are not configured.", 503);
    }
    if (!result.sent) {
      throw new AuthError("No active notification subscription was reachable.", 409);
    }
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Could not send a test notification." }, { status: 500 });
  }
}
