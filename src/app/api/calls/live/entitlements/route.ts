import { NextRequest, NextResponse } from "next/server";
import { AuthError, getRequestWorkspaceId, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { resolveLiveCallEntitlements } from "@/lib/brain/voice/speech-router";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lightweight entitlement probe for the call setup UI (premium voice gating). */
export async function GET(request: NextRequest) {
  try {
    const { user, client } = await requireAuthUser(request);
    const workspaceId = getRequestWorkspaceId(request);
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
    }
    await requireWorkspaceMembership(client, workspaceId, user.id);
    const entitlements = await resolveLiveCallEntitlements(client, workspaceId);
    const premiumConfigured =
      process.env.ADEHQ_LIVE_TTS_XAI_PREMIUM === "1" &&
      Boolean(process.env.XAI_API_KEY?.trim());
    const premiumVoiceEntitled = entitlements.premiumVoiceEnabled;
    return NextResponse.json({
      enabled: entitlements.enabled,
      /** Plan allows premium AND xAI premium TTS is configured. */
      premiumVoiceEnabled: premiumVoiceEntitled && premiumConfigured,
      /** Plan alone (ignores provider config) — used for accurate UI copy. */
      premiumVoiceEntitled,
      premiumConfigured,
      recordingEnabled: entitlements.recordingEnabled,
      maxCallDurationMinutes: entitlements.maxCallDurationMinutes,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Could not load call entitlements." }, { status: 500 });
  }
}
