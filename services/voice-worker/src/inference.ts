import WebSocket, { type RawData } from "ws";
import type {
  AudioFrame,
  SpeechToTextRequest,
  TextToSpeechRequest,
  TranscriptFrame,
  VoiceInferenceProvider,
} from "./contracts.js";

export interface StreamingSttProvider {
  readonly id: string;
  stream(request: SpeechToTextRequest): AsyncIterable<TranscriptFrame>;
}

export interface StreamingTtsProvider {
  readonly id: string;
  stream(request: TextToSpeechRequest): AsyncIterable<AudioFrame>;
}

export class ManagedVoiceInferenceProvider implements VoiceInferenceProvider {
  readonly id: string;
  readonly capabilities = { streamingStt: true, streamingTts: true };

  constructor(
    private readonly stt: StreamingSttProvider,
    private readonly tts: StreamingTtsProvider,
  ) {
    this.id = `${stt.id}+${tts.id}`;
  }

  streamTranscription(request: SpeechToTextRequest): AsyncIterable<TranscriptFrame> {
    return this.stt.stream(request);
  }

  streamSpeech(request: TextToSpeechRequest): AsyncIterable<AudioFrame> {
    return this.tts.stream(request);
  }
}

export class XaiStreamingSttProvider implements StreamingSttProvider {
  readonly id = "xai-streaming-stt";

  constructor(
    private readonly apiKey: string,
    private readonly endpoint = "wss://api.x.ai/v1/stt",
  ) {}

  async *stream(request: SpeechToTextRequest): AsyncIterable<TranscriptFrame> {
    const params = new URLSearchParams({
      sample_rate: "16000",
      encoding: "pcm",
      interim_results: "true",
      endpointing: "5000",
      filler_words: "true",
    });
    if (request.language) params.set("language", request.language);
    const socket = new WebSocket(`${this.endpoint}?${params}`, {
      headers: { authorization: `Bearer ${this.apiKey}` },
    });
    const events = new AsyncQueue<TranscriptFrame>();
    let sequence = 0;
    let ready = false;
    const close = () => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "audio.done" }));
      }
      socket.close();
    };
    request.signal.addEventListener("abort", close, { once: true });
    socket.on("message", (data: RawData) => {
      let event: {
        type?: string;
        text?: string;
        language?: string;
        is_final?: boolean;
        speech_final?: boolean;
        end_of_turn_confidence?: number;
        message?: string;
      };
      try {
        event = JSON.parse(data.toString()) as typeof event;
      } catch {
        events.fail(new Error("xAI streaming STT returned an invalid event"));
        return;
      }
      if (event.type === "transcript.created") {
        ready = true;
        return;
      }
      if (event.type === "transcript.partial" && event.text?.trim()) {
        events.push({
          type: "transcript",
          text: event.text.trim(),
          isFinal: Boolean(event.is_final && event.speech_final),
          confidence: event.end_of_turn_confidence,
          language: event.language,
          sequence: sequence++,
          timestampMs: Date.now(),
          traceId: request.metadata?.callId ?? crypto.randomUUID(),
        });
      } else if (event.type === "error") {
        events.fail(new Error(event.message ?? "xAI streaming STT failed"));
      }
    });
    socket.on("error", (error) => events.fail(error));
    socket.on("close", () => events.end());

    await waitFor(() => ready, socket, "xAI streaming STT did not become ready");
    void (async () => {
      try {
        for await (const frame of request.audio) {
          if (request.signal.aborted) break;
          if (frame.format.encoding !== "pcm_s16le" || frame.format.sampleRateHz !== 16_000) {
            throw new Error("xAI streaming STT requires mono PCM16 at 16kHz");
          }
          socket.send(frame.data);
        }
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "audio.done" }));
        }
      } catch (error) {
        events.fail(error instanceof Error ? error : new Error(String(error)));
        close();
      }
    })();
    try {
      yield* events;
    } finally {
      request.signal.removeEventListener("abort", close);
      close();
    }
  }
}

abstract class HttpStreamingTtsProvider implements StreamingTtsProvider {
  abstract readonly id: string;
  abstract request(input: TextToSpeechRequest): Promise<Response>;

  async *stream(input: TextToSpeechRequest): AsyncIterable<AudioFrame> {
    const response = await this.request(input);
    if (!response.ok) throw new Error(`${this.id} failed with HTTP ${response.status}`);
    if (!response.body) throw new Error(`${this.id} returned no audio stream`);
    const reader = response.body.getReader();
    let sequence = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value?.byteLength) continue;
        yield {
          type: "audio",
          direction: "output",
          format: input.outputFormat,
          data: value,
          sequence: sequence++,
          timestampMs: Date.now(),
          traceId: input.metadata?.turnId ?? crypto.randomUUID(),
        };
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }
}

export class XaiStreamingTtsProvider extends HttpStreamingTtsProvider {
  readonly id = "xai-streaming-tts";

  constructor(
    private readonly apiKey: string,
    private readonly endpoint = "https://api.x.ai/v1/tts",
  ) {
    super();
  }

  request(input: TextToSpeechRequest): Promise<Response> {
    return fetch(this.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        text: input.text,
        voice_id: input.voice ?? "eve",
        language: "en",
        output_format: {
          codec: input.outputFormat.encoding === "pcm_s16le" ? "pcm" : "mp3",
          sample_rate: input.outputFormat.sampleRateHz,
        },
        optimize_streaming_latency: 1,
      }),
      signal: input.signal,
    });
  }
}

export class FishStreamingTtsProvider extends HttpStreamingTtsProvider {
  readonly id = "fish-streaming-tts";

  constructor(
    private readonly apiKey: string,
    private readonly model = "s2.1-pro",
    private readonly referenceId?: string,
    private readonly endpoint = "https://api.fish.audio/v1/tts",
  ) {
    super();
  }

  request(input: TextToSpeechRequest): Promise<Response> {
    return fetch(this.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        model: this.model,
      },
      body: JSON.stringify({
        text: input.text,
        format: input.outputFormat.encoding === "pcm_s16le" ? "pcm" : "mp3",
        latency: "normal",
        reference_id: input.voice ?? this.referenceId,
      }),
      signal: input.signal,
    });
  }
}

class AsyncQueue<T> implements AsyncIterable<T> {
  #values: T[] = [];
  #waiters: Array<{ resolve: (value: IteratorResult<T>) => void; reject: (error: Error) => void }> =
    [];
  #closed = false;
  #error?: Error;

  push(value: T): void {
    if (this.#closed) return;
    const waiter = this.#waiters.shift();
    if (waiter) waiter.resolve({ value, done: false });
    else this.#values.push(value);
  }

  end(): void {
    this.#closed = true;
    for (const waiter of this.#waiters.splice(0)) {
      waiter.resolve({ value: undefined, done: true });
    }
  }

  fail(error: Error): void {
    this.#error = error;
    this.#closed = true;
    for (const waiter of this.#waiters.splice(0)) waiter.reject(error);
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.#values.shift();
        if (value !== undefined) return Promise.resolve({ value, done: false });
        if (this.#error) return Promise.reject(this.#error);
        if (this.#closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve, reject) => this.#waiters.push({ resolve, reject }));
      },
    };
  }
}

async function waitFor(
  predicate: () => boolean,
  socket: WebSocket,
  message: string,
): Promise<void> {
  if (predicate()) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(message));
      socket.close();
    }, 10_000);
    const onMessage = () => {
      if (!predicate()) return;
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off("message", onMessage);
      socket.off("error", onError);
    };
    socket.on("message", onMessage);
    socket.once("error", onError);
  });
}
