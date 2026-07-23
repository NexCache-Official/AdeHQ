import type { BrainApiClient, SfuMediaAdapter, SfuTrackRef } from "./boundaries.js";
import type {
  AudioFrame,
  TranscriptFrame,
  VoiceInferenceProvider,
} from "./contracts.js";
import type { TurnDetector } from "./turn-detector.js";

export interface VoiceSessionInput {
  callId: string;
  workspaceId: string;
  participantId: string;
  workerToken: string;
  inputTrack: SfuTrackRef;
  onReady?: () => void;
}

export class VoiceOrchestrator {
  readonly #sessionController = new AbortController();
  #turnController?: AbortController;
  #activeTurnId?: string;
  #finalTranscript: TranscriptFrame[] = [];
  #turnReady = false;

  constructor(
    private readonly sfu: SfuMediaAdapter,
    private readonly inference: VoiceInferenceProvider,
    private readonly brain: BrainApiClient,
    private readonly turnDetector: TurnDetector,
  ) {}

  async run(input: VoiceSessionInput): Promise<void> {
    const signal = this.#sessionController.signal;
    await this.sfu.connect({
      callId: input.callId,
      participantId: input.participantId,
      workerToken: input.workerToken,
      signal,
    });
    input.onReady?.();

    const sttAudio = new AsyncFrameQueue<AudioFrame>();
    const transcription = this.#consumeTranscription(sttAudio, input);
    try {
      for await (const frame of this.sfu.subscribe(input.inputTrack, signal)) {
        if (signal.aborted) break;
        sttAudio.push(frame);
        const events = await this.turnDetector.observeAudio(frame, signal);
        if (events.some((event) => event.event === "speech_started") && this.#turnController) {
          await this.interrupt("human_barge_in", input.workerToken);
        }
        if (events.some((event) => event.event === "turn_ready")) {
          this.#turnReady = true;
          await this.#speakTurn(input);
        }
      }
    } finally {
      sttAudio.close();
      await transcription;
      await this.sfu.disconnect(signal.aborted ? "cancelled" : "completed");
    }
  }

  async interrupt(reason: string, workerToken: string): Promise<void> {
    this.#turnController?.abort(reason);
    this.#turnController = undefined;
    if (this.#activeTurnId) {
      const turnId = this.#activeTurnId;
      this.#activeTurnId = undefined;
      await this.brain.cancelTurn(turnId, workerToken).catch(() => undefined);
    }
  }

  async stop(workerToken: string): Promise<void> {
    await this.interrupt("session_stopped", workerToken);
    this.#sessionController.abort("session_stopped");
  }

  async #consumeTranscription(
    audio: AsyncIterable<AudioFrame>,
    input: VoiceSessionInput,
  ): Promise<void> {
    for await (const transcript of this.inference.streamTranscription({
      audio,
      signal: this.#sessionController.signal,
      metadata: { callId: input.callId, workspaceId: input.workspaceId },
    })) {
      if (transcript.isFinal) this.#finalTranscript.push(transcript);
      const events = await this.turnDetector.observeTranscript(
        transcript,
        this.#sessionController.signal,
      );
      if (events.some((event) => event.event === "turn_ready")) {
        this.#turnReady = true;
      }
      if (transcript.isFinal && this.#turnReady) await this.#speakTurn(input);
    }
  }

  async #speakTurn(input: VoiceSessionInput): Promise<void> {
    if (!this.#turnReady || this.#finalTranscript.length === 0 || this.#turnController) return;
    const transcript = this.#finalTranscript.splice(0);
    this.#turnReady = false;
    const controller = new AbortController();
    this.#turnController = controller;
    const cancelSession = () => controller.abort(this.#sessionController.signal.reason);
    this.#sessionController.signal.addEventListener("abort", cancelSession, { once: true });
    try {
      const turn = await this.brain.createTurn({
        callId: input.callId,
        workspaceId: input.workspaceId,
        transcript,
        workerToken: input.workerToken,
        signal: controller.signal,
      });
      this.#activeTurnId = turn.turnId;
      const speech = this.inference.streamSpeech({
        text: turn.text,
        voice: turn.voice,
        outputFormat: {
          encoding: "pcm_s16le",
          sampleRateHz: 24_000,
          channels: 1,
        },
        signal: controller.signal,
        metadata: { callId: input.callId, turnId: turn.turnId },
      });
      await this.sfu.publish(speech, controller.signal);
    } finally {
      this.#sessionController.signal.removeEventListener("abort", cancelSession);
      this.#activeTurnId = undefined;
      this.#turnController = undefined;
    }
  }
}

class AsyncFrameQueue<T> implements AsyncIterable<T> {
  #values: T[] = [];
  #waiters: Array<(result: IteratorResult<T>) => void> = [];
  #closed = false;

  push(value: T): void {
    if (this.#closed) return;
    const waiter = this.#waiters.shift();
    if (waiter) waiter({ value, done: false });
    else this.#values.push(value);
  }

  close(): void {
    this.#closed = true;
    for (const waiter of this.#waiters.splice(0)) {
      waiter({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.#values.shift();
        if (value !== undefined) return Promise.resolve({ value, done: false });
        if (this.#closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => this.#waiters.push(resolve));
      },
    };
  }
}
