import { NextRequest, NextResponse } from "next/server";
import {
  AuthError,
  getRequestWorkspaceId,
  requireAuthUser,
  requireWorkspaceMembership,
} from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import {
  FishAudioTtsAdapter,
  normalizeEmployeeVoiceProfile,
  resolveProviderVoice,
  SiliconFlowStreamingTtsAdapter,
  XaiTtsAdapter,
} from "@/lib/brain/voice";
import { recordBrainUsage } from "@/lib/brain/metering";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ employeeId: string }> },
) {
  try {
    const { employeeId } = await params;
    const { user, client } = await requireAuthUser(request);
    const workspaceId = getRequestWorkspaceId(request);
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
    }
    await requireWorkspaceMembership(client, workspaceId, user.id);
    const secret = createSupabaseSecretClient();
    const { data: employee, error } = await secret
      .from("ai_employees")
      .select("name, voice_profile")
      .eq("workspace_id", workspaceId)
      .eq("id", employeeId)
      .maybeSingle();
    if (error) throw error;
    if (!employee) {
      return NextResponse.json({ error: "Employee not found." }, { status: 404 });
    }
    const profile = normalizeEmployeeVoiceProfile(
      employeeId,
      employee.voice_profile,
    );
    const configuredProvider = (
      process.env.ADEHQ_LIVE_TTS_STANDARD_PROVIDER ?? "xai"
    ).toLowerCase();
    const provider =
      configuredProvider === "fish"
        ? "fish"
        : configuredProvider === "siliconflow"
          ? "siliconflow"
          : "xai";
    const voice = resolveProviderVoice(profile, provider, "standard");
    const text = `Hi, I'm ${String(employee.name ?? "your employee")}. This is how I'll sound in calls.`;
    const adapter =
      provider === "fish"
        ? new FishAudioTtsAdapter()
        : provider === "siliconflow"
          ? new SiliconFlowStreamingTtsAdapter()
          : new XaiTtsAdapter();
    const result = await adapter.synthesize({
      text,
      voice,
      locale: profile.locale,
      speed: profile.pace,
      format: "mp3",
    });
    await recordBrainUsage({
      client: secret,
      workspaceId,
      idempotencyKey: `voice-preview:${user.id}:${employeeId}:${Date.now()}`,
      employeeId,
      userId: user.id,
      sourceType: "artifact",
      routeId: result.routeId,
      usage:
        result.routeId === "route_call_tts_xai"
          ? { ttsCharacters: result.characters }
          : { ttsUtf8Bytes: result.utf8Bytes },
      status: "succeeded",
      billableToWorkspace: false,
      capability: "text_to_speech",
      workType: "call_tts",
      runtimeMode: "voice_call",
      metadata: {
        treatment: "included_allowance",
        allowanceBucket: "tts_starter",
        voicePreview: true,
        provider,
      },
    });
    return new NextResponse(new Uint8Array(result.bytes), {
      headers: {
        "Content-Type": result.mimeType,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Could not preview this voice." }, { status: 500 });
  }
}
