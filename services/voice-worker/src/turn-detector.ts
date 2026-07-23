import type { AudioFrame, TranscriptFrame, TurnFrame } from "./contracts.js";

export interface TurnModelResult {
  speechProbability?: number;
  turnCompleteProbability?: number;
}

export interface CpuOnnxTurnModel {
  readonly id: "silero-vad" | "smart-turn";
  readonly loaded: boolean;
  infer(input: {
    pcm16: Int16Array;
    sampleRateHz: number;
    transcript?: string;
    signal: AbortSignal;
  }): Promise<TurnModelResult>;
}

export interface TurnDetector {
  readonly status: {
    silero: "loaded" | "unavailable";
    smartTurn: "loaded" | "unavailable";
    fallback: "energy-vad-timeout";
  };
  observeAudio(frame: AudioFrame, signal: AbortSignal): Promise<TurnFrame[]>;
  observeTranscript(frame: TranscriptFrame, signal: AbortSignal): Promise<TurnFrame[]>;
  reset(): void;
}

export interface LocalTurnDetectorOptions {
  silero?: CpuOnnxTurnModel;
  smartTurn?: CpuOnnxTurnModel;
  speechThreshold?: number;
  silenceTimeoutMs?: number;
  energyThreshold?: number;
}

export class LocalOnnxTurnDetector implements TurnDetector {
  readonly status;
  readonly #silero?: CpuOnnxTurnModel;
  readonly #smartTurn?: CpuOnnxTurnModel;
  readonly #speechThreshold: number;
  readonly #silenceTimeoutMs: number;
  readonly #energyThreshold: number;
  #speaking = false;
  #lastSpeechMs?: number;
  #sequence = 0;

  constructor(options: LocalTurnDetectorOptions = {}) {
    this.#silero = options.silero?.loaded ? options.silero : undefined;
    this.#smartTurn = options.smartTurn?.loaded ? options.smartTurn : undefined;
    this.#speechThreshold = options.speechThreshold ?? 0.5;
    this.#silenceTimeoutMs = options.silenceTimeoutMs ?? 800;
    this.#energyThreshold = options.energyThreshold ?? 0.012;
    this.status = {
      silero: this.#silero ? ("loaded" as const) : ("unavailable" as const),
      smartTurn: this.#smartTurn ? ("loaded" as const) : ("unavailable" as const),
      fallback: "energy-vad-timeout" as const,
    };
  }

  async observeAudio(frame: AudioFrame, signal: AbortSignal): Promise<TurnFrame[]> {
    if (frame.format.encoding !== "pcm_s16le") return [];
    const pcm16 = new Int16Array(
      frame.data.buffer,
      frame.data.byteOffset,
      Math.floor(frame.data.byteLength / Int16Array.BYTES_PER_ELEMENT),
    );
    const probability = this.#silero
      ? (await this.#silero.infer({
          pcm16,
          sampleRateHz: frame.format.sampleRateHz,
          signal,
        })).speechProbability ?? 0
      : normalizedRms(pcm16);
    const speech = probability >= (this.#silero ? this.#speechThreshold : this.#energyThreshold);
    const events: TurnFrame[] = [];

    if (speech) {
      this.#lastSpeechMs = frame.timestampMs;
      if (!this.#speaking) {
        this.#speaking = true;
        events.push(this.#event(frame, "speech_started", "vad"));
      }
    } else if (
      this.#speaking &&
      this.#lastSpeechMs !== undefined &&
      frame.timestampMs - this.#lastSpeechMs >= this.#silenceTimeoutMs
    ) {
      this.#speaking = false;
      events.push(this.#event(frame, "speech_stopped", "vad"));
      events.push(this.#event(frame, "turn_ready", "timeout"));
    }
    return events;
  }

  async observeTranscript(frame: TranscriptFrame, signal: AbortSignal): Promise<TurnFrame[]> {
    if (!frame.isFinal || !this.#smartTurn) return [];
    const result = await this.#smartTurn.infer({
      pcm16: new Int16Array(),
      sampleRateHz: 16_000,
      transcript: frame.text,
      signal,
    });
    if ((result.turnCompleteProbability ?? 0) < this.#speechThreshold) return [];
    this.#speaking = false;
    return [this.#event(frame, "turn_ready", "semantic")];
  }

  reset(): void {
    this.#speaking = false;
    this.#lastSpeechMs = undefined;
  }

  #event(
    frame: Pick<AudioFrame | TranscriptFrame, "timestampMs" | "traceId">,
    event: TurnFrame["event"],
    reason: TurnFrame["reason"],
  ): TurnFrame {
    return {
      type: "turn",
      event,
      reason,
      sequence: ++this.#sequence,
      timestampMs: frame.timestampMs,
      traceId: frame.traceId,
    };
  }
}

function normalizedRms(samples: Int16Array): number {
  if (samples.length === 0) return 0;
  let sumSquares = 0;
  for (const sample of samples) {
    const normalized = sample / 32768;
    sumSquares += normalized * normalized;
  }
  return Math.sqrt(sumSquares / samples.length);
}
