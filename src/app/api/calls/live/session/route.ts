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
  streamingSttConfigured,
} from "@/lib/brain/voice";
import {
  checkMonthlyLiveCallMinutes,
  settleBrainLiveCall,
} from "@/lib/billing/voice/usage";
import { isMayaEmployee } from "@/lib/maya-employee";
import { resolveLiveCallsTransport } from "@/lib/brain/voice/worker-transport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { user, client } = await requireAuthUser(request);
    const workspaceId = getRequestWorkspaceId(request);
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
    }
    await requireWorkspaceMembership(client, workspaceId, user.id);
    const service = createSupabaseSecretClient();
    const [{ data: calls, error }, usage] = await Promise.all([
      service
        .from("calls")
        .select(
          "id, title, status, session_state, started_at, ended_at, duration_seconds, live_call_minutes, created_at",
        )
        .eq("workspace_id", workspaceId)
        .eq("initiator_user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(25),
      checkMonthlyLiveCallMinutes(service, workspaceId),
    ]);
    if (error) throw error;
    const callIds = (calls ?? []).map((call) => String(call.id));
    const { data: settlements, error: settlementError } = callIds.length
      ? await service
          .from("call_usage_settlements")
          .select("call_id, customer_charged_wh")
          .eq("workspace_id", workspaceId)
          .in("call_id", callIds)
      : { data: [], error: null };
    if (settlementError) throw settlementError;
    const whByCall = new Map<string, number>();
    for (const settlement of settlements ?? []) {
      const callId = String(settlement.call_id);
      whByCall.set(
        callId,
        (whByCall.get(callId) ?? 0) +
          Number(settlement.customer_charged_wh ?? 0),
      );
    }
    return NextResponse.json({
      calls: (calls ?? []).map((call) => ({
        id: String(call.id),
        title: String(call.title ?? "AI employee call"),
        status: String(call.session_state ?? call.status ?? "ended"),
        startedAt: call.started_at ? String(call.started_at) : null,
        endedAt: call.ended_at ? String(call.ended_at) : null,
        durationSeconds:
          call.duration_seconds == null ? null : Number(call.duration_seconds),
        liveCallMinutes: Number(call.live_call_minutes ?? 0),
        aiWorkHours: whByCall.get(String(call.id)) ?? 0,
        transcriptIncluded: usage.entitlements.transcriptIncluded,
        captionsIncluded: usage.entitlements.captionsIncluded,
        createdAt: String(call.created_at),
      })),
      monthlyUsage: usage,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Could not load call receipts." }, { status: 500 });
  }
}

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
    const { data: employeeRow, error: employeeError } = await client
      .from("ai_employees")
      .select("id, system_employee_key")
      .eq("workspace_id", workspaceId)
      .eq("id", employeeId)
      .maybeSingle();
    if (employeeError) throw employeeError;
    if (
      !employeeRow ||
      isMayaEmployee({
        id: String(employeeRow.id),
        systemEmployeeKey:
          typeof employeeRow.system_employee_key === "string"
            ? employeeRow.system_employee_key
            : null,
      })
    ) {
      return NextResponse.json(
        { error: "Maya is not available for calls. Choose a hired AI employee." },
        { status: 422 },
      );
    }
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

    const orchestrationClient = createSupabaseSecretClient();
    const [entitlements, monthlyUsage] = await Promise.all([
      resolveLiveCallEntitlements(client, workspaceId),
      checkMonthlyLiveCallMinutes(orchestrationClient, workspaceId),
    ]);
    if (!entitlements.enabled) {
      return NextResponse.json(
        { error: "Live calls are not enabled for this workspace." },
        { status: 403 },
      );
    }
    if (!monthlyUsage.allowed) {
      return NextResponse.json(
        {
          error: "This workspace has used its included live-call minutes for this month.",
          code: "live_call_minutes_exhausted",
          monthlyUsage,
        },
        { status: 429 },
      );
    }
    if (monthlyUsage.remainingMinutes !== null) {
      entitlements.maxCallDurationMinutes = Math.max(
        1,
        Math.min(
          entitlements.maxCallDurationMinutes,
          Math.ceil(monthlyUsage.remainingMinutes),
        ),
      );
    }
    const groqRepairConfigured =
      process.env.ADEHQ_LIVE_STT_GROQ !== "0" &&
      Boolean(process.env.GROQ_API_KEY?.trim());
    const liveStreamingConfigured =
      process.env.ADEHQ_LIVE_STT_MODE === "live_streaming" &&
      streamingSttConfigured() &&
      groqRepairConfigured;
    const requestedLiveStreaming = body.sttMode === "live_streaming";
    const sttMode =
      requestedLiveStreaming && liveStreamingConfigured
        ? "live_streaming"
        : "fast_turn";
    if (!groqRepairConfigured) {
      return NextResponse.json(
        { error: "Call transcription and repair are not configured." },
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
    const standardProvider = (
      process.env.ADEHQ_LIVE_TTS_STANDARD_PROVIDER ?? "xai"
    ).toLowerCase();
    const standardConfigured =
      standardProvider === "xai"
        ? Boolean(process.env.XAI_API_KEY?.trim())
        : standardProvider === "fish"
          ? Boolean(process.env.FISH_AUDIO_API_KEY?.trim())
          : standardProvider === "siliconflow"
            ? process.env.ADEHQ_LIVE_TTS_SILICONFLOW !== "0" &&
              Boolean(process.env.SILICONFLOW_API_KEY?.trim())
            : false;
    if (body.voice !== "premium" && !standardConfigured) {
      return NextResponse.json(
        { error: "Standard call voice is not configured." },
        { status: 503 },
      );
    }
    const voice = body.voice === "premium" ? "premium" : "standard";
    const transport = await resolveLiveCallsTransport();
    const created = await createCallSession(orchestrationClient, {
      workspaceId,
      conversationType: "human_ai_dm",
      conversationId,
      initiatorUserId: user.id,
      primaryEmployeeId: employeeId,
      participantIds: [user.id, employeeId],
      sttMode,
      voiceRoutePolicy: voice,
      title: `Call with ${String(room.name ?? "employee")}`,
      entitlements,
    });
    return NextResponse.json({
      ...created,
      sttMode,
      sttFallback:
        requestedLiveStreaming && sttMode === "fast_turn"
          ? "streaming_unavailable"
          : null,
      voice,
      entitlements,
      monthlyUsage,
      bargeInEnabled: process.env.ADEHQ_CALL_BARGE_IN_V1 !== "0",
      transport: transport.selected,
      transportRequested: transport.requested,
      transportFallbackReason: transport.fallbackReason ?? null,
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
      const receipt = await settleBrainLiveCall(orchestrationClient, {
        workspaceId,
        callId: body.callId,
      });
      return NextResponse.json({ ok: true, receipt });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Could not update call." }, { status: 500 });
  }
}
