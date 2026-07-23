/**
 * Shared helpers for local_instant / voice_fast lanes inside a live call turn.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AIEmployee } from "@/lib/types";
import { persistEmployeeEffects } from "@/lib/server/room-messages";
import { resolveLocalInstantReply } from "./local-instant-replies";
import { runVoiceFastBrain } from "./voice-fast-brain";
import type { VoiceBrainRouteDecision } from "./voice-brain-router";
import {
  appendVoiceSessionTurn,
  type VoiceSessionSnapshot,
} from "./voice-session-snapshot";
import {
  markVoiceBrainLatency,
  type VoiceBrainLatencyTrace,
} from "./voice-latency-trace";
import { scheduleVoiceAsyncEffects } from "./async-effect-compiler";
import { StreamReplySanitizer } from "@/lib/ai/normalize-model-response";

export async function generateVoiceLaneReply(input: {
  decision: VoiceBrainRouteDecision;
  snapshot: VoiceSessionSnapshot;
  userMessage: string;
  seed: string;
  onReplyDelta: (delta: string) => void;
  abortSignal?: AbortSignal;
  trace?: VoiceBrainLatencyTrace;
}): Promise<{
  reply: string;
  model: string | null;
  provider: string | null;
  inputTokens?: number;
  outputTokens?: number;
}> {
  if (input.decision.route === "local_instant") {
    const lastEmployee = [...input.snapshot.recentTurns]
      .reverse()
      .find((turn) => turn.speaker === "employee")?.text;
    const reply =
      resolveLocalInstantReply({
        decision: input.decision,
        employeeName: input.snapshot.employeeName,
        seed: input.seed,
        lastEmployeeText: lastEmployee,
      }) ?? "Okay.";
    if (input.trace) {
      input.trace.provider = "local";
      input.trace.model = "local_instant";
      input.trace.promptTokens = 0;
      markVoiceBrainLatency(input.trace, "promptCompiled");
      markVoiceBrainLatency(input.trace, "providerRequestStarted");
      markVoiceBrainLatency(input.trace, "providerFirstEvent");
      markVoiceBrainLatency(input.trace, "providerFirstContentToken");
    }
    input.onReplyDelta(reply);
    return { reply, model: "local_instant", provider: "local" };
  }

  const sanitizer = new StreamReplySanitizer();
  const result = await runVoiceFastBrain({
    snapshot: input.snapshot,
    userMessage: input.userMessage,
    abortSignal: input.abortSignal,
    trace: input.trace,
    onReplyDelta: (delta) => {
      const safe = sanitizer.push(delta);
      if (safe) input.onReplyDelta(safe);
    },
  });
  const trailing = sanitizer.finish();
  if (trailing) input.onReplyDelta(trailing);
  return {
    reply: result.reply || sanitizer.sanitizedText,
    model: result.model,
    provider: result.provider,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  };
}

export async function persistVoiceLaneReply(input: {
  client: SupabaseClient;
  workspaceId: string;
  roomId: string;
  topicId: string;
  employee: AIEmployee;
  reply: string;
  triggerMessageId: string;
  callId: string;
  turnId: string;
  humanUserId: string;
  userMessage: string;
  route: "local_instant" | "voice_fast";
  snapshot: VoiceSessionSnapshot;
}): Promise<void> {
  await persistEmployeeEffects(
    input.client,
    input.workspaceId,
    input.roomId,
    input.topicId,
    input.employee,
    input.reply,
    { workLog: [], tasks: [], memory: [], approvals: [] },
    input.triggerMessageId,
  );
  appendVoiceSessionTurn(input.callId, {
    speaker: "employee",
    text: input.reply,
    at: new Date().toISOString(),
  });
  scheduleVoiceAsyncEffects({
    client: input.client,
    workspaceId: input.workspaceId,
    roomId: input.roomId,
    topicId: input.topicId,
    employeeId: input.employee.id,
    employeeName: input.employee.name,
    humanUserId: input.humanUserId,
    callId: input.callId,
    turnId: input.turnId,
    userMessage: input.userMessage,
    employeeReply: input.reply,
    route: input.route,
  });
}
