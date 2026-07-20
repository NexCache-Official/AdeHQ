import { randomUUID } from "node:crypto";
import {
  experimental_upgradeWebSocket,
  type WebSocket as VercelWebSocket,
  type WebSocketData,
} from "@vercel/functions";
import { NextRequest, NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import {
  executeEmployeeCallTurn,
  resolveLiveCallEntitlements,
  setCallSessionState,
  SupabaseCallTransientCoordinator,
  verifyCallSessionToken,
  type ClientCallEvent,
  type ServerCallEvent,
} from "@/lib/brain/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function rawText(data: WebSocketData): string {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data).toString("utf8");
}

function send(ws: VercelWebSocket, event: ServerCallEvent): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
}

export async function GET(request: NextRequest) {
  try {
    const { user, client } = await requireAuthUser(request);
    const token = request.nextUrl.searchParams.get("token");
    if (!token) {
      return NextResponse.json({ error: "Call session token required." }, { status: 401 });
    }
    const payload = verifyCallSessionToken(token);
    if (payload.userId !== user.id) {
      return NextResponse.json({ error: "Call session token does not match user." }, { status: 403 });
    }
    const { data: call, error } = await client
      .from("calls")
      .select(
        "id, workspace_id, room_id, initiator_user_id, primary_employee_id, stt_mode, voice_route_policy, session_state",
      )
      .eq("workspace_id", payload.workspaceId)
      .eq("id", payload.callId)
      .maybeSingle();
    if (error) throw error;
    if (!call || String(call.initiator_user_id) !== user.id) {
      return NextResponse.json({ error: "Call not found." }, { status: 404 });
    }
    const entitlements = await resolveLiveCallEntitlements(client, payload.workspaceId);
    if (!entitlements.enabled) {
      return NextResponse.json({ error: "Live calls are not enabled." }, { status: 403 });
    }
    const orchestrationClient = createSupabaseSecretClient();

    return experimental_upgradeWebSocket(async (ws) => {
      const connectionId = randomUUID();
      const coordinator = new SupabaseCallTransientCoordinator(
        orchestrationClient,
        payload.workspaceId,
      );
      let frames: Buffer[] = [];
      let frameBytes = 0;
      let sequence = 0;
      let muted = false;
      let closed = false;
      let turnChain = Promise.resolve();
      let turnAbort: AbortController | null = null;
      let idleTimeout: ReturnType<typeof setTimeout> | null = null;

      const closeExpiredCall = (message: string) => {
        if (closed) return;
        closed = true;
        turnAbort?.abort(new Error(message));
        send(ws, {
          type: "error",
          code: "call_limit_reached",
          message,
          recoverable: false,
        });
        void setCallSessionState(orchestrationClient, {
          workspaceId: payload.workspaceId,
          callId: payload.callId,
          state: "ended",
        }).finally(() => ws.close(1000, message.slice(0, 120)));
      };
      const resetIdleTimeout = () => {
        if (idleTimeout) clearTimeout(idleTimeout);
        idleTimeout = setTimeout(
          () => closeExpiredCall("The call ended after being idle."),
          entitlements.maxIdleMinutes * 60_000,
        );
      };

      await coordinator.claim(payload.callId, connectionId, 45);
      await setCallSessionState(orchestrationClient, {
        workspaceId: payload.workspaceId,
        callId: payload.callId,
        state: "active",
      });
      send(ws, {
        type: "session.ready",
        callSessionId: payload.callId,
        sessionToken: token,
      });
      send(ws, { type: "state.changed", session: "active", turn: "listening" });
      resetIdleTimeout();
      const durationTimeout = setTimeout(
        () => closeExpiredCall("The maximum call duration was reached."),
        Math.max(1_000, payload.expiresAt - Date.now()),
      );

      const heartbeat = setInterval(() => {
        void coordinator
          .heartbeat(payload.callId, connectionId, 45)
          .catch(() => undefined);
      }, 15_000);

      ws.on("message", (data) => {
        let event: ClientCallEvent;
        try {
          event = JSON.parse(rawText(data)) as ClientCallEvent;
        } catch {
          send(ws, {
            type: "error",
            code: "invalid_event",
            message: "Invalid call event.",
            recoverable: true,
          });
          return;
        }

        if (event.type === "audio.append") {
          if (muted || turnAbort) return;
          resetIdleTimeout();
          const chunk = Buffer.from(event.pcm, "base64");
          if (chunk.length > 64 * 1024 || frameBytes + chunk.length > 8 * 1024 * 1024) {
            send(ws, {
              type: "error",
              code: "audio_limit",
              message: "The current utterance is too long.",
              recoverable: true,
            });
            frames = [];
            frameBytes = 0;
            return;
          }
          frames.push(chunk);
          frameBytes += chunk.length;
          return;
        }

        if (event.type === "audio.commit") {
          resetIdleTimeout();
          const utterance = Buffer.concat(frames);
          frames = [];
          frameBytes = 0;
          if (!utterance.length) return;
          const turnSequence = sequence++;
          turnChain = turnChain
            .then(async () => {
              turnAbort = new AbortController();
              try {
                const { data: recordingState } = await orchestrationClient
                  .from("calls")
                  .select("recording_consent_at")
                  .eq("workspace_id", payload.workspaceId)
                  .eq("id", payload.callId)
                  .maybeSingle();
                await executeEmployeeCallTurn({
                  client: orchestrationClient,
                  workspaceId: payload.workspaceId,
                  humanUserId: user.id,
                  employeeId: String(call.primary_employee_id),
                  roomId: String(call.room_id),
                  callSessionId: payload.callId,
                  sequence: turnSequence,
                  pcm16: utterance,
                  durationSeconds: Math.max(0.1, event.durationSeconds),
                  routeContext: {
                    callMode: "fast_turn",
                    premiumVoiceRequested: call.voice_route_policy === "premium",
                    entitlements,
                  },
                  saveRecording: Boolean(recordingState?.recording_consent_at),
                  emit: (outgoing) => send(ws, outgoing),
                  signal: turnAbort.signal,
                });
              } catch (turnError) {
                send(ws, {
                  type: "error",
                  code:
                    turnError instanceof Error && turnError.name === "AbortError"
                      ? "turn_interrupted"
                      : "turn_failed",
                  message:
                    turnError instanceof Error
                      ? turnError.message
                      : "The employee could not complete this turn.",
                  recoverable: true,
                });
              } finally {
                turnAbort = null;
                if (!closed) {
                  send(ws, {
                    type: "state.changed",
                    session: "active",
                    turn: "listening",
                    activity: "waiting",
                  });
                }
              }
            })
            .catch(() => undefined);
          return;
        }

        if (event.type === "interrupt") {
          turnAbort?.abort(new Error("User interrupted."));
          void coordinator.signalInterrupt(payload.callId);
          send(ws, {
            type: "state.changed",
            session: "active",
            turn: "interrupted",
            activity: "waiting",
          });
          return;
        }
        if (event.type === "mute") {
          muted = event.muted;
          if (muted) {
            frames = [];
            frameBytes = 0;
          }
          return;
        }
        if (event.type === "end_call") {
          closed = true;
          if (idleTimeout) clearTimeout(idleTimeout);
          clearTimeout(durationTimeout);
          turnAbort?.abort(new Error("Call ended."));
          void setCallSessionState(orchestrationClient, {
            workspaceId: payload.workspaceId,
            callId: payload.callId,
            state: "ended",
          }).finally(() => ws.close(1000, "Call ended."));
        }
      });

      ws.on("close", () => {
        clearInterval(heartbeat);
        if (idleTimeout) clearTimeout(idleTimeout);
        clearTimeout(durationTimeout);
        turnAbort?.abort(new Error("Call transport disconnected."));
        if (!closed) {
          void setCallSessionState(orchestrationClient, {
            workspaceId: payload.workspaceId,
            callId: payload.callId,
            state: "reconnecting",
          });
        }
        void coordinator.release(payload.callId, connectionId);
      });
    }, { maxPayload: 256 * 1024 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not open call transport." },
      { status: 401 },
    );
  }
}
