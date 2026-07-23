import { randomUUID } from "node:crypto";
import {
  experimental_upgradeWebSocket,
  type WebSocket as VercelWebSocket,
  type WebSocketData,
} from "@vercel/functions";
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import {
  buildCallVocabulary,
  executeEmployeeCallTurn,
  resolveLiveCallEntitlements,
  selectSpeechRoutes,
  setCallSessionState,
  SupabaseCallTransientCoordinator,
  verifyCallSessionToken,
  type ClientCallEvent,
  type FinalTranscript,
  type ServerCallEvent,
  type StreamingTranscriptionSession,
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
      const streamingEnabled = call.stt_mode === "live_streaming";
      const streamAbort = new AbortController();
      let streamingSession: StreamingTranscriptionSession | null = null;
      let streamingFailure: Error | null = null;
      let streamAppendChain = Promise.resolve();
      const streamingFinals: FinalTranscript[] = [];
      const streamingWaiters: Array<{
        resolve: (transcript: FinalTranscript) => void;
        reject: (error: Error) => void;
        timeout: ReturnType<typeof setTimeout>;
      }> = [];

      const failStreaming = (error: unknown) => {
        if (streamingFailure) return;
        streamingFailure =
          error instanceof Error ? error : new Error(String(error));
        for (const waiter of streamingWaiters.splice(0)) {
          clearTimeout(waiter.timeout);
          waiter.reject(streamingFailure);
        }
      };
      const disableStreaming = (reason: string) => {
        failStreaming(new Error(reason));
        void streamingSession?.close().catch(() => undefined);
      };
      const awaitStreamingFinal = async (): Promise<FinalTranscript> => {
        const queued = streamingFinals.shift();
        if (queued) return queued;
        if (streamingFailure) throw streamingFailure;
        return new Promise<FinalTranscript>((resolve, reject) => {
          const waiter = {
            resolve,
            reject,
            timeout: setTimeout(() => {
              const index = streamingWaiters.indexOf(waiter);
              if (index >= 0) streamingWaiters.splice(index, 1);
              reject(new Error("Streaming STT final transcript timed out."));
            }, 6_000),
          };
          streamingWaiters.push(waiter);
        });
      };

      const closeExpiredCall = (message: string) => {
        if (closed) return;
        closed = true;
        turnAbort?.abort(new Error(message));
        streamAbort.abort(new Error(message));
        void streamingSession?.close().catch(() => undefined);
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

      if (streamingEnabled) {
        try {
          const vocabularyPrompt = await buildCallVocabulary(orchestrationClient, {
            workspaceId: payload.workspaceId,
            conversationId: String(call.room_id),
            humanUserId,
            employeeId: String(call.primary_employee_id),
          });
          const selected = selectSpeechRoutes({
            callMode: "live_streaming",
            truePartialsRequired: true,
            premiumVoiceRequested: call.voice_route_policy === "premium",
            entitlements,
          });
          if (!selected.stt.openStream) {
            throw new Error("Selected streaming STT route cannot open a stream.");
          }
          const openedSession = await selected.stt.openStream({
            workspaceId: payload.workspaceId,
            conversationId: String(call.room_id),
            humanUserId,
            employeeId: String(call.primary_employee_id),
            vocabularyPrompt,
            signal: streamAbort.signal,
          });
          streamingSession = openedSession;
          void (async () => {
            try {
              for await (const transcriptEvent of openedSession.events) {
                if (transcriptEvent.type === "partial") {
                  send(ws, {
                    type: "transcript.partial",
                    text: transcriptEvent.text,
                    source: "streaming_stt",
                  });
                  continue;
                }
                const waiter = streamingWaiters.shift();
                if (waiter) {
                  clearTimeout(waiter.timeout);
                  waiter.resolve(transcriptEvent.transcript);
                } else {
                  streamingFinals.push(transcriptEvent.transcript);
                }
              }
            } catch (streamError) {
              failStreaming(streamError);
            }
          })();
        } catch (streamError) {
          failStreaming(streamError);
        }
      }

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
            if (streamingEnabled) {
              disableStreaming("Streaming STT stopped after the audio limit.");
            }
            return;
          }
          frames.push(chunk);
          frameBytes += chunk.length;
          if (streamingSession && !streamingFailure) {
            const activeSession = streamingSession;
            streamAppendChain = streamAppendChain
              .then(() => activeSession.append(chunk))
              .catch((streamError) => failStreaming(streamError));
          }
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
                let finalTranscript: FinalTranscript | undefined;
                let effectiveCallMode: "fast_turn" | "live_streaming" =
                  streamingEnabled ? "live_streaming" : "fast_turn";
                if (streamingEnabled) {
                  try {
                    await streamAppendChain;
                    if (!streamingSession || streamingFailure) {
                      throw (
                        streamingFailure ??
                        new Error("Streaming STT session is unavailable.")
                      );
                    }
                    await streamingSession.commit();
                    finalTranscript = await awaitStreamingFinal();
                    // The browser's Smart Turn boundary is authoritative for
                    // the utterance duration, independent of provider timing.
                    finalTranscript = {
                      ...finalTranscript,
                      actualAudioSeconds: Math.max(0.1, event.durationSeconds),
                    };
                  } catch (streamError) {
                    effectiveCallMode = "fast_turn";
                    disableStreaming(
                      streamError instanceof Error
                        ? streamError.message
                        : "Streaming STT failed.",
                    );
                    if (callDebugEnabled()) {
                      console.warn("[AdeHQ live-call] streaming STT repair", {
                        callId: payload.callId,
                        sequence: turnSequence,
                        error:
                          streamError instanceof Error
                            ? streamError.message
                            : String(streamError),
                      });
                    }
                  }
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
                    callMode: effectiveCallMode,
                    premiumVoiceRequested: call.voice_route_policy === "premium",
                    entitlements,
                  },
                  finalTranscript,
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
            const hadBufferedAudio = frameBytes > 0;
            frames = [];
            frameBytes = 0;
            if (hadBufferedAudio && streamingEnabled && streamingSession) {
              disableStreaming("Streaming STT stopped after input was muted.");
            }
          }
          return;
        }
        if (event.type === "end_call") {
          closed = true;
          if (idleTimeout) clearTimeout(idleTimeout);
          clearTimeout(durationTimeout);
          turnAbort?.abort(new Error("Call ended."));
          streamAbort.abort(new Error("Call ended."));
          void streamingSession?.close().catch(() => undefined);
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
        streamAbort.abort(new Error("Call transport disconnected."));
        void streamingSession?.close().catch(() => undefined);
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
