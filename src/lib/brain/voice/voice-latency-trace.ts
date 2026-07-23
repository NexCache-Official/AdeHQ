/**
 * PR-18.2A5 — Voice Brain latency waterfall.
 * Marks AdeHQ prep vs provider TTFT so we stop guessing where 3–6s goes.
 */

export type VoiceBrainRoute = "local_instant" | "voice_fast" | "work_full";

export type VoiceBrainLatencyTrace = {
  callId: string;
  turnId: string;
  route?: VoiceBrainRoute;
  warm: boolean;
  serverlessColdStart?: boolean;
  promptTokens?: number;
  provider?: string;
  model?: string;
  retryCount: number;
  fallbackUsed: boolean;

  turnReceivedAt: number;
  authCompleteAt?: number;
  sessionLoadedAt?: number;
  contextFetchCompleteAt?: number;
  promptCompiledAt?: number;
  routingCompleteAt?: number;

  providerRequestStartedAt?: number;
  providerHeadersReceivedAt?: number;
  providerFirstEventAt?: number;
  providerFirstReasoningTokenAt?: number;
  providerFirstContentTokenAt?: number;

  firstSpeakablePhraseAt?: number;
  firstTtsByteAt?: number;
  clientPlaybackStartedAt?: number;
};

export type VoiceBrainLatencyMark =
  | "authComplete"
  | "sessionLoaded"
  | "contextFetchComplete"
  | "promptCompiled"
  | "routingComplete"
  | "providerRequestStarted"
  | "providerHeadersReceived"
  | "providerFirstEvent"
  | "providerFirstReasoningToken"
  | "providerFirstContentToken"
  | "firstSpeakablePhrase"
  | "firstTtsByte"
  | "clientPlaybackStarted";

const MARK_TO_FIELD: Record<VoiceBrainLatencyMark, keyof VoiceBrainLatencyTrace> = {
  authComplete: "authCompleteAt",
  sessionLoaded: "sessionLoadedAt",
  contextFetchComplete: "contextFetchCompleteAt",
  promptCompiled: "promptCompiledAt",
  routingComplete: "routingCompleteAt",
  providerRequestStarted: "providerRequestStartedAt",
  providerHeadersReceived: "providerHeadersReceivedAt",
  providerFirstEvent: "providerFirstEventAt",
  providerFirstReasoningToken: "providerFirstReasoningTokenAt",
  providerFirstContentToken: "providerFirstContentTokenAt",
  firstSpeakablePhrase: "firstSpeakablePhraseAt",
  firstTtsByte: "firstTtsByteAt",
  clientPlaybackStarted: "clientPlaybackStartedAt",
};

export function createVoiceBrainLatencyTrace(input: {
  callId: string;
  turnId: string;
  warm?: boolean;
  serverlessColdStart?: boolean;
}): VoiceBrainLatencyTrace {
  return {
    callId: input.callId,
    turnId: input.turnId,
    warm: Boolean(input.warm),
    serverlessColdStart: input.serverlessColdStart,
    retryCount: 0,
    fallbackUsed: false,
    turnReceivedAt: Date.now(),
  };
}

export function markVoiceBrainLatency(
  trace: VoiceBrainLatencyTrace,
  mark: VoiceBrainLatencyMark,
  at = Date.now(),
): void {
  const field = MARK_TO_FIELD[mark];
  if (trace[field] != null) return;
  (trace as Record<string, unknown>)[field] = at;
}

export function voiceBrainLatencyDurations(trace: VoiceBrainLatencyTrace): {
  adehqPrepMs: number | null;
  providerTtftMs: number | null;
  firstPhraseMs: number | null;
  firstAudioMs: number | null;
  endToEndMs: number | null;
} {
  const start = trace.turnReceivedAt;
  const prepEnd =
    trace.providerRequestStartedAt ??
    trace.routingCompleteAt ??
    trace.promptCompiledAt ??
    null;
  return {
    adehqPrepMs: prepEnd != null ? prepEnd - start : null,
    providerTtftMs:
      trace.providerRequestStartedAt != null &&
      trace.providerFirstContentTokenAt != null
        ? trace.providerFirstContentTokenAt - trace.providerRequestStartedAt
        : null,
    firstPhraseMs:
      trace.firstSpeakablePhraseAt != null
        ? trace.firstSpeakablePhraseAt - start
        : null,
    firstAudioMs:
      trace.firstTtsByteAt != null ? trace.firstTtsByteAt - start : null,
    endToEndMs:
      trace.firstTtsByteAt != null ? trace.firstTtsByteAt - start : null,
  };
}

export function voiceBrainLatencyMetadata(
  trace: VoiceBrainLatencyTrace,
): Record<string, unknown> {
  const durations = voiceBrainLatencyDurations(trace);
  return {
    voiceBrainLatency: {
      route: trace.route ?? null,
      warm: trace.warm,
      serverlessColdStart: trace.serverlessColdStart ?? null,
      promptTokens: trace.promptTokens ?? null,
      provider: trace.provider ?? null,
      model: trace.model ?? null,
      retryCount: trace.retryCount,
      fallbackUsed: trace.fallbackUsed,
      marks: {
        turnReceivedAt: trace.turnReceivedAt,
        authCompleteAt: trace.authCompleteAt ?? null,
        sessionLoadedAt: trace.sessionLoadedAt ?? null,
        contextFetchCompleteAt: trace.contextFetchCompleteAt ?? null,
        promptCompiledAt: trace.promptCompiledAt ?? null,
        routingCompleteAt: trace.routingCompleteAt ?? null,
        providerRequestStartedAt: trace.providerRequestStartedAt ?? null,
        providerHeadersReceivedAt: trace.providerHeadersReceivedAt ?? null,
        providerFirstEventAt: trace.providerFirstEventAt ?? null,
        providerFirstReasoningTokenAt:
          trace.providerFirstReasoningTokenAt ?? null,
        providerFirstContentTokenAt: trace.providerFirstContentTokenAt ?? null,
        firstSpeakablePhraseAt: trace.firstSpeakablePhraseAt ?? null,
        firstTtsByteAt: trace.firstTtsByteAt ?? null,
        clientPlaybackStartedAt: trace.clientPlaybackStartedAt ?? null,
      },
      durations,
    },
  };
}

export function logVoiceBrainLatency(trace: VoiceBrainLatencyTrace): void {
  if (process.env.ADEHQ_LIVE_CALL_DEBUG !== "1") return;
  const durations = voiceBrainLatencyDurations(trace);
  console.info("[AdeHQ voice-brain-latency]", {
    callId: trace.callId,
    turnId: trace.turnId,
    route: trace.route,
    warm: trace.warm,
    provider: trace.provider,
    model: trace.model,
    promptTokens: trace.promptTokens,
    ...durations,
  });
}
