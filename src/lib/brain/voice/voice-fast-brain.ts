/**
 * PR-18.2A7 lane B — Fast conversational Brain.
 * Compact prompt, no tools, no thinking, no structured output, ≤120 tokens.
 */

import { SILICONFLOW_CHEAP_MODEL } from "@/lib/config/features";
import { streamSiliconFlowText } from "@/lib/ai/siliconflow-call";
import { sanitizeReplyForChat } from "@/lib/ai/normalize-model-response";
import {
  compileVoiceFastPrompt,
  type VoiceSessionSnapshot,
} from "./voice-session-snapshot";
import {
  markVoiceBrainLatency,
  type VoiceBrainLatencyTrace,
} from "./voice-latency-trace";

export type VoiceFastBrainResult = {
  reply: string;
  model: string;
  provider: string;
  inputTokens?: number;
  outputTokens?: number;
};

export function resolveVoiceFastModel(): string {
  return (
    process.env.ADEHQ_VOICE_FAST_MODEL?.trim() ||
    SILICONFLOW_CHEAP_MODEL ||
    "deepseek-ai/DeepSeek-V4-Flash"
  );
}

export async function runVoiceFastBrain(input: {
  snapshot: VoiceSessionSnapshot;
  userMessage: string;
  onReplyDelta: (delta: string) => void;
  abortSignal?: AbortSignal;
  trace?: VoiceBrainLatencyTrace;
}): Promise<VoiceFastBrainResult> {
  const compiled = compileVoiceFastPrompt({
    snapshot: input.snapshot,
    userMessage: input.userMessage,
  });
  const model = resolveVoiceFastModel();
  if (input.trace) {
    input.trace.promptTokens = compiled.estimatedTokens;
    input.trace.provider = "siliconflow";
    input.trace.model = model;
    markVoiceBrainLatency(input.trace, "promptCompiled");
    markVoiceBrainLatency(input.trace, "providerRequestStarted");
  }

  const result = await streamSiliconFlowText(
    compiled.system,
    compiled.prompt,
    model,
    120,
    Number(process.env.ADEHQ_VOICE_FAST_TIMEOUT_MS ?? 8_000),
    0.35,
    (delta) => {
      if (input.trace && !input.trace.providerFirstEventAt) {
        markVoiceBrainLatency(input.trace, "providerFirstEvent");
        markVoiceBrainLatency(input.trace, "providerHeadersReceived");
      }
      if (input.trace && !input.trace.providerFirstContentTokenAt && delta.trim()) {
        markVoiceBrainLatency(input.trace, "providerFirstContentToken");
      }
      input.onReplyDelta(delta);
    },
    input.abortSignal,
  );

  return {
    reply: sanitizeReplyForChat(result.text),
    model: result.model,
    provider: "siliconflow",
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  };
}
