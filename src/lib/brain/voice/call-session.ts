import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CallConversationType,
  CallSessionState,
  CallSttMode,
  CallTurnState,
  CallUsageOutcome,
  LiveCallEntitlements,
} from "./live-types";

type SessionTokenPayload = {
  callId: string;
  workspaceId: string;
  userId: string;
  expiresAt: number;
};

function tokenSecret(): string {
  const secret =
    process.env.ADEHQ_CALL_SESSION_SECRET?.trim() ??
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ??
    process.env.SUPABASE_SECRET_KEY?.trim();
  if (!secret) throw new Error("ADEHQ_CALL_SESSION_SECRET is not configured.");
  return secret;
}

function encode(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function createCallSessionToken(payload: SessionTokenPayload): string {
  const body = encode(payload);
  const signature = createHmac("sha256", tokenSecret()).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function verifyCallSessionToken(token: string): SessionTokenPayload {
  const [body, supplied] = token.split(".");
  if (!body || !supplied) throw new Error("Invalid call session token.");
  const expected = createHmac("sha256", tokenSecret()).update(body).digest();
  const actual = Buffer.from(supplied, "base64url");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error("Invalid call session token.");
  }
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionTokenPayload;
  if (payload.expiresAt <= Date.now()) throw new Error("Call session token expired.");
  return payload;
}

export async function assertCallConcurrency(
  client: SupabaseClient,
  input: {
    workspaceId: string;
    userId: string;
    entitlements: LiveCallEntitlements;
  },
): Promise<void> {
  const activeStates = ["connecting", "active", "reconnecting", "ending"];
  const [workspace, human] = await Promise.all([
    client
      .from("calls")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", input.workspaceId)
      .in("session_state", activeStates),
    client
      .from("calls")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", input.workspaceId)
      .eq("initiator_user_id", input.userId)
      .in("session_state", activeStates),
  ]);
  if (workspace.error) throw workspace.error;
  if (human.error) throw human.error;
  if ((workspace.count ?? 0) >= input.entitlements.maxConcurrentCallsPerWorkspace) {
    throw new Error("This workspace has reached its concurrent call limit.");
  }
  if ((human.count ?? 0) >= input.entitlements.maxConcurrentCallsPerHuman) {
    throw new Error("You already have an active call.");
  }
}

export async function createCallSession(
  client: SupabaseClient,
  input: {
    workspaceId: string;
    conversationType: CallConversationType;
    conversationId: string;
    initiatorUserId: string;
    primaryEmployeeId: string;
    participantIds: string[];
    sttMode: CallSttMode;
    voiceRoutePolicy: "standard" | "premium";
    title: string;
    entitlements: LiveCallEntitlements;
  },
): Promise<{ callId: string; sessionToken: string; reconnectExpiresAt: string }> {
  if (input.conversationType !== "human_ai_dm") {
    throw new Error("Realtime Brain Calls V1 supports private employee DMs only.");
  }
  await assertCallConcurrency(client, {
    workspaceId: input.workspaceId,
    userId: input.initiatorUserId,
    entitlements: input.entitlements,
  });
  const callId = `call_${randomUUID()}`;
  const reconnectExpiresAt = new Date(
    Date.now() + input.entitlements.maxCallDurationMinutes * 60_000,
  ).toISOString();
  const { error } = await client.from("calls").insert({
    workspace_id: input.workspaceId,
    id: callId,
    room_id: input.conversationId,
    conversation_type: input.conversationType,
    conversation_id: input.conversationId,
    initiator_user_id: input.initiatorUserId,
    primary_employee_id: input.primaryEmployeeId,
    participant_ids: input.participantIds,
    permission_version: 1,
    stt_mode: input.sttMode,
    voice_route_policy: input.voiceRoutePolicy,
    session_state: "connecting",
    status: "live",
    title: input.title,
    participants: [],
    transcript: [],
    action_items: [],
    reconnect_expires_at: reconnectExpiresAt,
    metadata: {
      transport: "vercel_websocket",
      maxIdleMinutes: input.entitlements.maxIdleMinutes,
      maxTurnWh: input.entitlements.maxTurnWh,
      recordingEnabled: input.entitlements.recordingEnabled,
      transcriptRetentionDays: input.entitlements.transcriptRetentionDays,
    },
  });
  if (error) throw error;
  const sessionToken = createCallSessionToken({
    callId,
    workspaceId: input.workspaceId,
    userId: input.initiatorUserId,
    expiresAt: Date.parse(reconnectExpiresAt),
  });
  return { callId, sessionToken, reconnectExpiresAt };
}

export async function setCallSessionState(
  client: SupabaseClient,
  input: {
    workspaceId: string;
    callId: string;
    state: CallSessionState;
    estimatedWh?: number;
    settledWh?: number;
  },
): Promise<void> {
  const terminal = input.state === "ended" || input.state === "failed";
  const { error } = await client
    .from("calls")
    .update({
      session_state: input.state,
      status: terminal ? "ended" : "live",
      last_activity_at: new Date().toISOString(),
      ended_at: terminal ? new Date().toISOString() : undefined,
      estimated_wh: input.estimatedWh,
      settled_wh: input.settledWh,
    })
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.callId);
  if (error) throw error;
}

export async function upsertCallTurn(
  client: SupabaseClient,
  input: {
    workspaceId: string;
    callId: string;
    turnId: string;
    sequence: number;
    idempotencyKey: string;
    state: CallTurnState;
    values?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await client.from("call_turns").upsert(
    {
      workspace_id: input.workspaceId,
      call_id: input.callId,
      id: input.turnId,
      sequence: input.sequence,
      idempotency_key: input.idempotencyKey,
      state: input.state,
      updated_at: new Date().toISOString(),
      ...(input.values ?? {}),
    },
    { onConflict: "workspace_id,idempotency_key" },
  );
  if (error) throw error;
}

export async function settleCallComponent(
  client: SupabaseClient,
  input: {
    workspaceId: string;
    callId: string;
    turnId: string;
    component: "stt" | "brain" | "tts";
    routeId?: string;
    idempotencyKey: string;
    estimatedWh: number;
    reservedWh: number;
    actualWh: number;
    customerChargedWh: number;
    outcome: CallUsageOutcome;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await client.from("call_usage_settlements").upsert(
    {
      workspace_id: input.workspaceId,
      call_id: input.callId,
      turn_id: input.turnId,
      component: input.component,
      route_id: input.routeId ?? null,
      idempotency_key: input.idempotencyKey,
      estimated_wh: input.estimatedWh,
      reserved_wh: input.reservedWh,
      actual_wh: input.actualWh,
      customer_charged_wh: input.customerChargedWh,
      outcome: input.outcome,
      metadata: input.metadata ?? {},
      settled_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id,idempotency_key" },
  );
  if (error) throw error;
}
