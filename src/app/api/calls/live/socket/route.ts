import { randomUUID } from "node:crypto";
import {
  experimental_upgradeWebSocket,
  type WebSocket as VercelWebSocket,
  type WebSocketData,
} from "@vercel/functions";
import { NextRequest, NextResponse } from "next/server";
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

const RECONNECTABLE_STATES = new Set([
  "connecting",
  "active",
  "reconnecting",
]);

function rawText(data: WebSocketData): string {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data).toString("utf8");
}

function send(ws: VercelWebSocket, event: ServerCallEvent): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
}

function callDebugEnabled(): boolean {
  const raw = process.env.ADEHQ_LIVE_CALL_DEBUG?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on" || raw === "yes";
}

export async function GET(request: NextRequest) {
  try {
    // Browser WebSockets cannot set Authorization headers. Authenticate with the
    // short-lived HMAC session token issued by the authenticated session POST.
    const token = request.nextUrl.searchParams.get("token");
    if (!token) {
      return NextResponse.json({ error: "Call session token required." }, { status: 401 });
    }
    let payload: ReturnType<typeof verifyCallSessionToken>;
    try {
      payload = verifyCallSessionToken(token);
    } catch (tokenError) {
      return NextResponse.json(
        {
          error:
            tokenError instanceof Error
              ? tokenError.message
              : "Invalid call session token.",
        },
        { status: 401 },
      );
    }

    const orchestrationClient = createSupabaseSecretClient();
    const { data: call, error } = await orchestrationClient
      .from("calls")
      .select(
        "id, workspace_id, room_id, initiator_user_id, primary_employee_id, stt_mode, voice_route_policy, session_state, reconnect_expires_at",
      )
      .eq("workspace_id", payload.workspaceId)
      .eq("id", payload.callId)
      .maybeSingle();
    if (error) throw error;
    if (!call || String(call.initiator_user_id) !== payload.userId) {
      return NextResponse.json({ error: "Call not found." }, { status: 404 });
    }
    const sessionState = String(call.session_state ?? "");
    if (!RECONNECTABLE_STATES.has(sessionState)) {
      return NextResponse.json(
        { error: "This call is no longer available to reconnect." },
        { status: 409 },
      );
    }
    if (
      call.reconnect_expires_at &&
      new Date(String(call.reconnect_expires_at)).getTime() <= Date.now()
    ) {
      return NextResponse.json(
        { error: "The call reconnect window has expired." },
        { status: 409 },
      );
    }
    const entitlements = await resolveLiveCallEntitlements(
      orchestrationClient,
      payload.workspaceId,
    );
    if (!entitlements.enabled) {
      return NextResponse.json({ error: "Live calls are not enabled." }, { status: 403 });
    }

    return experimental_upgradeWebSocket(async (ws) => {
      const connectionId = randomUUID();
      const humanUserId = payload.userId;
      const coordinator = new SupabaseCallTransientCoordinator(
        orchestrationClient,
        payload.workspaceId,
      );
      if (callDebugEnabled()) {
        console.info("[AdeHQ live-call] socket ready", {
          callId: payload.callId,
          workspaceId: payload.workspaceId,
          connectionId,
          sessionState,
        });
      }
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
                if (callDebugEnabled()) {
                  console.info("[AdeHQ live-call] turn start", {
                    callId: payload.callId,
                    sequence: turnSequence,
                    durationSeconds: event.durationSeconds,
                    bytes: utterance.byteLength,
                  });
                }
                await executeEmployeeCallTurn({
                  client: orchestrationClient,
                  workspaceId: payload.workspaceId,
                  humanUserId,
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
                  emit: (outgoing) => {
                    if (
                      callDebugEnabled() &&
                      (outgoing.type === "transcript.final" ||
                        outgoing.type === "state.changed" ||
                        outgoing.type === "error")
                    ) {
                      console.info("[AdeHQ live-call] emit", {
                        callId: payload.callId,
                        sequence: turnSequence,
                        type: outgoing.type,
                        ...(outgoing.type === "transcript.final"
                          ? { text: outgoing.text, source: outgoing.source }
                          : {}),
                        ...(outgoing.type === "state.changed"
                          ? { turn: outgoing.turn, activity: outgoing.activity }
                          : {}),
                        ...(outgoing.type === "error"
                          ? { code: outgoing.code, message: outgoing.message }
                          : {}),
                      });
                    }
                    send(ws, outgoing);
                  },
                  signal: turnAbort.signal,
                });
              } catch (turnError) {
                if (callDebugEnabled()) {
                  console.warn("[AdeHQ live-call] turn failed", {
                    callId: payload.callId,
                    sequence: turnSequence,
                    error:
                      turnError instanceof Error
                        ? turnError.message
                        : String(turnError),
                  });
                }
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
    const message =
      error instanceof Error ? error.message : "Could not open call transport.";
    const status = /not found|expired|no longer available/i.test(message)
      ? 409
      : /enabled|entitled|forbidden/i.test(message)
        ? 403
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
