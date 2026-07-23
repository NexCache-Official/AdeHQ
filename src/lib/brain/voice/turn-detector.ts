export type TurnDetectionInput = {
  speechDurationMs: number;
  silenceDurationMs: number;
  transcript?: string;
  semanticCompletionConfidence?: number;
};

export type TurnDetectionDecision = {
  commit: boolean;
  reason:
    | "speech_too_short"
    | "speech_continues"
    | "semantic_complete"
    | "semantic_incomplete"
    | "hard_timeout";
};

export interface LocalTurnDetector {
  evaluate(input: TurnDetectionInput): Promise<TurnDetectionDecision>;
}

export const DEFAULT_TURN_DETECTION_POLICY = {
  minimumSpeechMs: 250,
  minimumSilenceMs: 250,
  normalEndpointMs: 450,
  hardTimeoutMs: 800,
  completionThreshold: 0.55,
} as const;

/**
 * Fail-safe endpointing used in the browser and whenever the ONNX Smart Turn
 * model is unavailable. It intentionally accepts semantic confidence from a
 * local detector but never depends on a provider endpoint signal.
 */
export class HybridLocalTurnDetector implements LocalTurnDetector {
  constructor(
    private readonly policy: typeof DEFAULT_TURN_DETECTION_POLICY =
      DEFAULT_TURN_DETECTION_POLICY,
  ) {}

  async evaluate(input: TurnDetectionInput): Promise<TurnDetectionDecision> {
    if (input.speechDurationMs < this.policy.minimumSpeechMs) {
      return { commit: false, reason: "speech_too_short" };
    }
    if (input.silenceDurationMs < this.policy.minimumSilenceMs) {
      return { commit: false, reason: "speech_continues" };
    }
    if (input.silenceDurationMs >= this.policy.hardTimeoutMs) {
      return { commit: true, reason: "hard_timeout" };
    }
    if (
      input.silenceDurationMs >= this.policy.normalEndpointMs &&
      (input.semanticCompletionConfidence ?? 0) >= this.policy.completionThreshold
    ) {
      return { commit: true, reason: "semantic_complete" };
    }
    return { commit: false, reason: "semantic_incomplete" };
  }
}

