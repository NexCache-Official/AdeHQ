import { NextRequest, NextResponse } from "next/server";
import {
  AuthError,
  getRequestWorkspaceId,
  requireAuthUser,
  requireWorkspaceMembership,
} from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import {
  assertCanSendRoomMessage,
  assertEffectiveAiAccess,
} from "@/lib/server/room-access";
import {
  createCallSession,
  resolveLiveCallEntitlements,
  setCallSessionState,
} from "@/lib/brain/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { user, client } = await requireAuthUser(request);
    const workspaceId = getRequestWorkspaceId(request);
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
    }
    const body = (await request.json()) as {
      conversationType?: "human_ai_dm" | "room" | "topic";
      conversationId?: string;
      employeeId?: string;
      sttMode?: "fast_turn" | "live_streaming";
      voice?: "standard" | "premium";
    };
    const conversationId = body.conversationId?.trim();
    const employeeId = body.employeeId?.trim();
    if (!conversationId || !employeeId) {
      return NextResponse.json(
        { error: "conversationId and employeeId are required" },
        { status: 400 },
      );
    }
    const { role } = await requireWorkspaceMembership(client, workspaceId, user.id);
    await assertCanSendRoomMessage(
      client,
      workspaceId,
      conversationId,
      user.id,
      role,
    );
    await assertEffectiveAiAccess(
      client,
      workspaceId,
      conversationId,
      user.id,
      role,
      employeeId,
    );
    const { data: room, error: roomError } = await client
      .from("rooms")
      .select("kind, dm_employee_id, name")
      .eq("workspace_id", workspaceId)
      .eq("id", conversationId)
      .maybeSingle();
    if (roomError) throw roomError;
    if (!room || room.kind !== "dm" || String(room.dm_employee_id) !== employeeId) {
      return NextResponse.json(
        { error: "Realtime Brain Calls V1 supports private employee DMs only." },
        { status: 422 },
      );
    }

    const entitlements = await resolveLiveCallEntitlements(client, workspaceId);
    if (!entitlements.enabled) {
      return NextResponse.json(
        { error: "Live calls are not enabled for this workspace." },
        { status: 403 },
      );
    }
    if (body.sttMode === "live_streaming") {
      return NextResponse.json(
        { error: "Live captions require an entitled streaming STT route." },
        { status: 422 },
      );
    }
    if (
      process.env.ADEHQ_LIVE_STT_MODE === "live_streaming" ||
      process.env.ADEHQ_LIVE_STT_GROQ === "0" ||
      !process.env.GROQ_API_KEY?.trim()
    ) {
      return NextResponse.json(
        { error: "Fast-turn transcription is not configured." },
        { status: 503 },
      );
    }
    const premiumConfigured =
      process.env.ADEHQ_LIVE_TTS_XAI_PREMIUM === "1" &&
      Boolean(process.env.XAI_API_KEY?.trim());
    if (
      body.voice === "premium" &&
      (!entitlements.premiumVoiceEnabled || !premiumConfigured)
    ) {
      return NextResponse.json(
        { error: "Premium voice is not enabled for this workspace." },
        { status: 403 },
      );
    }
    if (
      body.voice !== "premium" &&
      (process.env.ADEHQ_LIVE_TTS_SILICONFLOW === "0" ||
        !process.env.SILICONFLOW_API_KEY?.trim())
    ) {
      return NextResponse.json(
        { error: "Standard call voice is not configured." },
        { status: 503 },
      );
    }
    const voice = body.voice === "premium" ? "premium" : "standard";
    const created = await createCallSession(createSupabaseSecretClient(), {
      workspaceId,
      conversationType: "human_ai_dm",
      conversationId,
      initiatorUserId: user.id,
      primaryEmployeeId: employeeId,
      participantIds: [user.id, employeeId],
      sttMode: "fast_turn",
      voiceRoutePolicy: voice,
      title: `Call with ${String(room.name ?? "employee")}`,
      entitlements,
    });
    return NextResponse.json({
      ...created,
      sttMode: "fast_turn",
      voice,
      entitlements,
      bargeInEnabled: process.env.ADEHQ_CALL_BARGE_IN_V1 !== "0",
      transportUrl: `/api/calls/live/socket?token=${encodeURIComponent(created.sessionToken)}`,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Could not start call.";
    const status = /limit|already have/i.test(message) ? 429 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { user, client } = await requireAuthUser(request);
    const workspaceId = getRequestWorkspaceId(request);
    const body = (await request.json()) as {
      callId?: string;
      action?: "end" | "recording_consent";
      recordingConsent?: boolean;
    };
    if (!workspaceId || !body.callId) {
      return NextResponse.json({ error: "workspaceId and callId required" }, { status: 400 });
    }
    await requireWorkspaceMembership(client, workspaceId, user.id);
    const { data: call, error } = await client
      .from("calls")
      .select("initiator_user_id")
      .eq("workspace_id", workspaceId)
      .eq("id", body.callId)
      .maybeSingle();
    if (error) throw error;
    if (!call || String(call.initiator_user_id) !== user.id) {
      throw new AuthError("Call not found.", 404);
    }
    const orchestrationClient = createSupabaseSecretClient();
    if (body.action === "recording_consent") {
      const entitlements = await resolveLiveCallEntitlements(client, workspaceId);
      if (!entitlements.enabled || !entitlements.recordingEnabled) {
        throw new AuthError("Call recording is not enabled for this workspace.", 403);
      }
      const { error: updateError } = await orchestrationClient
        .from("calls")
        .update({
          recording_consent_at: body.recordingConsent
            ? new Date().toISOString()
            : null,
        })
        .eq("workspace_id", workspaceId)
        .eq("id", body.callId);
      if (updateError) throw updateError;
    } else {
      await setCallSessionState(orchestrationClient, {
        workspaceId,
        callId: body.callId,
        state: "ended",
      });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Could not update call." }, { status: 500 });
  }
}
