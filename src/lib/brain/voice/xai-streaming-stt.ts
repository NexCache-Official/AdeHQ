import WebSocket, { type RawData } from "ws";
import type {
  FinalTranscript,
  SpeechContext,
  SpeechToTextAdapter,
  StreamingTranscriptEvent,
  StreamingTranscriptionSession,
  UtteranceInput,
} from "./live-types";
import { normalizeSpeechLanguage } from "./transcript-language";

const XAI_STREAMING_STT_URL = "wss://api.x.ai/v1/stt";

type XaiTranscriptEvent = {
  type?: string;
  text?: string;
  language?: string;
  duration?: number;
  is_final?: boolean;
  speech_final?: boolean;
  end_of_turn_confidence?: number;
  message?: string;
};

class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly queue: T[] = [];
  private readonly waiters: Array<{
    resolve: (result: IteratorResult<T>) => void;
    reject: (error: Error) => void;
  }> = [];
  private closed = false;
  private failure: Error | null = null;

  push(value: T): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve({ value, done: false });
    else this.queue.push(value);
  }

  end(): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter.resolve({ value: undefined as never, done: true });
    }
  }

  fail(error: Error): void {
    if (this.closed) return;
    this.failure = error;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter.reject(error);
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: async () => {
        const value = this.queue.shift();
        if (value !== undefined) return { value, done: false };
        if (this.failure) throw this.failure;
        if (this.closed) return { value: undefined as never, done: true };
        return new Promise<IteratorResult<T>>((resolve, reject) =>
          this.waiters.push({ resolve, reject }),
        );
      },
    };
  }
}

function vocabularyKeyterms(prompt?: string): string[] {
  if (!prompt) return [];
  return Array.from(
    new Set(
      prompt
        .split(/[\n,;|]/)
        .map((term) => term.trim())
        .filter((term) => term.length >= 2 && term.length <= 50),
    ),
  ).slice(0, 100);
}

/**
 * Provider-neutral live caption adapter. AdeHQ owns turn completion; xAI's
 * endpoint event is treated as transcript evidence, never as the sole floor
 * controller.
 */
export class XaiStreamingSttAdapter implements SpeechToTextAdapter {
  readonly mode = "streaming" as const;

  async transcribeUtterance(
    _input: UtteranceInput,
    _context: SpeechContext,
  ): Promise<FinalTranscript> {
    throw new Error("XaiStreamingSttAdapter requires openStream().");
  }

  async openStream(context: SpeechContext): Promise<StreamingTranscriptionSession> {
    const apiKey = process.env.XAI_API_KEY?.trim();
    if (!apiKey) throw new Error("XAI_API_KEY is not configured.");

    const params = new URLSearchParams({
      sample_rate: "16000",
      encoding: "pcm",
      interim_results: "true",
      // AdeHQ local VAD + Smart Turn controls commits. A long provider endpoint
      // avoids fighting local floor control while still yielding partials.
      endpointing: "5000",
      filler_words: "true",
      // Always pin a language. Unconstrained xAI STT can invent wrong-script
      // phrases (e.g. Russian "Продолжение следует..." for English speech).
      language: normalizeSpeechLanguage(context.language),
    });
    for (const keyterm of vocabularyKeyterms(context.vocabularyPrompt)) {
      params.append("keyterm", keyterm);
    }

    const socket = new WebSocket(`${XAI_STREAMING_STT_URL}?${params}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const events = new AsyncEventQueue<StreamingTranscriptEvent>();
    const startedAt = Date.now();
    let ready = false;
    let closed = false;
    let appendedBytes = 0;

    const close = () => {
      if (closed) return;
      closed = true;
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "audio.done" }));
      } else {
        socket.close();
      }
    };

    socket.on("message", (data: RawData) => {
      let event: XaiTranscriptEvent;
      try {
        event = JSON.parse(data.toString()) as XaiTranscriptEvent;
      } catch {
        events.fail(new Error("xAI streaming STT returned an invalid event."));
        return;
      }
      if (event.type === "transcript.created") {
        ready = true;
        return;
      }
      if (event.type === "transcript.partial") {
        const text = event.text?.trim() ?? "";
        if (!text) return;
        if (!event.is_final || !event.speech_final) {
          events.push({ type: "partial", text });
          return;
        }
        const audioSeconds = appendedBytes / (16_000 * 2);
        events.push({
          type: "final",
          transcript: {
            text,
            language: event.language ?? context.language,
            confidence: event.end_of_turn_confidence,
            providerDurationSeconds: event.duration,
            actualAudioSeconds: audioSeconds,
            billableAudioSeconds: audioSeconds,
            latencyMs: Date.now() - startedAt,
            routeId: "route_call_stt_streaming",
            raw: event,
          },
        });
        appendedBytes = 0;
        return;
      }
      if (event.type === "error") {
        events.fail(new Error(event.message ?? "xAI streaming STT failed."));
      }
    });
    socket.on("error", (error) => events.fail(error));
    socket.on("close", () => events.end());

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("xAI streaming STT did not become ready."));
        socket.close();
      }, 10_000);
      const onMessage = () => {
        if (!ready) return;
        clearTimeout(timeout);
        socket.off("message", onMessage);
        socket.off("error", onError);
        resolve();
      };
      const onError = (error: Error) => {
        clearTimeout(timeout);
        socket.off("message", onMessage);
        reject(error);
      };
      socket.on("message", onMessage);
      socket.once("error", onError);
    });

    context.signal?.addEventListener("abort", close, { once: true });

    return {
      append: async (frame) => {
        if (closed || socket.readyState !== WebSocket.OPEN) {
          throw new Error("Streaming transcription session is closed.");
        }
        appendedBytes += frame.byteLength;
        socket.send(frame);
      },
      commit: async () => {
        if (!closed && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "Finalize" }));
        }
      },
      close: async () => close(),
      events,
    };
  }
}
