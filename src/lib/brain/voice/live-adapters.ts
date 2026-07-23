import { SILICONFLOW_API_BASE_URL } from "@/lib/config/features";
import { decode, encode } from "@msgpack/msgpack";
import WebSocket, { type RawData } from "ws";
import type {
  FinalTranscript,
  RealtimeTtsSession,
  SpeechAudioChunk,
  SpeechContext,
  SpeechSynthesisInput,
  SpeechSynthesisResult,
  SpeechToTextAdapter,
  StreamingSpeechSession,
  TextToSpeechAdapter,
  UtteranceInput,
} from "./live-types";

const GROQ_STT_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const XAI_TTS_URL = "https://api.x.ai/v1/tts";
const XAI_STREAMING_TTS_URL = "wss://api.x.ai/v1/tts";
const FISH_TTS_URL = "https://api.fish.audio/v1/tts";
const FISH_STREAMING_TTS_URL = "wss://api.fish.audio/v1/tts/live";
export const GROQ_MINIMUM_BILLABLE_SECONDS = 10;

function apiError(label: string, response: Response, body: string): Error {
  return new Error(`${label} failed (${response.status}): ${body.slice(0, 240)}`);
}

function createAudioQueue() {
  const queue: SpeechAudioChunk[] = [];
  let completed = false;
  let failure: Error | null = null;
  let wake: (() => void) | null = null;
  const notify = () => {
    wake?.();
    wake = null;
  };
  return {
    push(chunk: SpeechAudioChunk) {
      if (completed) return;
      queue.push(chunk);
      notify();
    },
    finish() {
      completed = true;
      notify();
    },
    fail(error: Error) {
      failure = error;
      completed = true;
      notify();
    },
    chunks: (async function* () {
      while (!completed || queue.length > 0) {
        const chunk = queue.shift();
        if (chunk) {
          yield chunk;
          continue;
        }
        if (failure) throw failure;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
      if (failure) throw failure;
    })(),
  };
}

export class GroqWhisperAdapter implements SpeechToTextAdapter {
  readonly mode = "batch_utterance" as const;

  constructor(
    private readonly model:
      | "whisper-large-v3-turbo"
      | "whisper-large-v3" = "whisper-large-v3-turbo",
  ) {}

  async transcribeUtterance(
    input: UtteranceInput,
    context: SpeechContext,
  ): Promise<FinalTranscript> {
    const apiKey = process.env.GROQ_API_KEY?.trim();
    if (!apiKey) throw new Error("GROQ_API_KEY is not configured.");
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(input.bytes)], { type: input.mimeType }),
      input.fileName,
    );
    form.append("model", this.model);
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "segment");
    form.append("language", (context.language ?? "en").trim() || "en");
    if (context.vocabularyPrompt) {
      form.append("prompt", context.vocabularyPrompt.slice(0, 900));
    }

    const started = Date.now();
    const response = await fetch(GROQ_STT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: context.signal ?? AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw apiError("Groq transcription", response, await response.text().catch(() => ""));
    }
    const raw = (await response.json()) as Record<string, unknown>;
    const text = typeof raw.text === "string" ? raw.text.trim() : "";
    const providerDuration =
      typeof raw.duration === "number" && Number.isFinite(raw.duration)
        ? raw.duration
        : undefined;
    const avgLogProb = Array.isArray(raw.segments)
      ? (raw.segments as Array<Record<string, unknown>>)
          .map((segment) => Number(segment.avg_logprob))
          .filter(Number.isFinite)
      : [];
    const confidence = avgLogProb.length
      ? Math.max(
          0,
          Math.min(
            1,
            1 + avgLogProb.reduce((sum, value) => sum + value, 0) / avgLogProb.length,
          ),
        )
      : undefined;

    return {
      text,
      language: typeof raw.language === "string" ? raw.language : context.language,
      confidence,
      providerDurationSeconds: providerDuration,
      actualAudioSeconds: input.durationSeconds,
      billableAudioSeconds: Math.max(
        input.durationSeconds,
        GROQ_MINIMUM_BILLABLE_SECONDS,
      ),
      latencyMs: Date.now() - started,
      routeId:
        this.model === "whisper-large-v3"
          ? "route_call_stt_groq_accurate"
          : "route_call_stt_groq_turbo",
      raw,
    };
  }
}

export class SiliconFlowStreamingTtsAdapter implements TextToSpeechAdapter {
  readonly mode = "streaming_audio" as const;

  private async request(input: SpeechSynthesisInput): Promise<Response> {
    const apiKey = process.env.SILICONFLOW_API_KEY?.trim();
    if (!apiKey) throw new Error("SILICONFLOW_API_KEY is not configured.");
    const baseUrl = SILICONFLOW_API_BASE_URL.replace(/\/$/, "");
    const response = await fetch(`${baseUrl}/audio/speech`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "FunAudioLLM/CosyVoice2-0.5B",
        input: input.text,
        voice: input.voice ?? "FunAudioLLM/CosyVoice2-0.5B:alex",
        response_format: input.format ?? "mp3",
        speed: input.speed ?? 1,
        stream: true,
      }),
      signal: input.signal ?? AbortSignal.timeout(45_000),
    });
    if (!response.ok) {
      throw apiError("SiliconFlow TTS", response, await response.text().catch(() => ""));
    }
    return response;
  }

  async synthesize(input: SpeechSynthesisInput): Promise<SpeechSynthesisResult> {
    const started = Date.now();
    const response = await this.request(input);
    return {
      bytes: Buffer.from(await response.arrayBuffer()),
      mimeType: response.headers.get("content-type")?.split(";")[0] ?? "audio/mpeg",
      utf8Bytes: Buffer.byteLength(input.text, "utf8"),
      characters: Array.from(input.text).length,
      latencyMs: Date.now() - started,
      routeId: "route_tts_cosyvoice2",
    };
  }

  async openStream(input: SpeechSynthesisInput): Promise<StreamingSpeechSession> {
    const session = await this.openRealtimeSession(input);
    await session.appendText(input.text);
    await session.flush();
    return {
      chunks: session.chunks,
      cancel: (reason) => session.interrupt(reason),
    };
  }

  async openRealtimeSession(
    input: Omit<SpeechSynthesisInput, "text">,
  ): Promise<RealtimeTtsSession> {
    const controller = new AbortController();
    const queue = createAudioQueue();
    let sequence = 0;
    let closed = false;
    let chain = Promise.resolve();
    const signal = input.signal
      ? AbortSignal.any([input.signal, controller.signal])
      : controller.signal;

    const appendText = async (text: string) => {
      if (closed) throw new Error("TTS session is closed.");
      if (!text.trim()) return;
      const task = chain.then(async () => {
        // Forward HTTP body chunks as they arrive. The previous arrayBuffer()
        // path waited for the entire CosyVoice payload before any playback.
        const response = await this.request({
          ...input,
          text,
          format: "wav",
          signal,
        });
        const mimeType =
          response.headers.get("content-type")?.split(";")[0] ?? "audio/wav";
        const body = response.body;
        if (!body) {
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (bytes.byteLength) {
            queue.push({ sequence: sequence++, bytes, mimeType });
          }
          return;
        }
        const reader = body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value?.byteLength) continue;
          queue.push({
            sequence: sequence++,
            bytes: value,
            mimeType,
          });
        }
      });
      chain = task.catch((error) => {
        closed = true;
        queue.fail(error instanceof Error ? error : new Error(String(error)));
      });
      await task;
    };

    return {
      chunks: queue.chunks,
      appendText,
      flush: async () => {
        await chain;
        if (!closed) queue.finish();
      },
      interrupt: async (reason) => {
        if (closed) return;
        closed = true;
        controller.abort(new Error(reason ?? "Speech interrupted."));
        queue.finish();
      },
      close: async () => {
        if (closed) return;
        await chain;
        closed = true;
        queue.finish();
      },
    };
  }
}

export class FishAudioTtsAdapter implements TextToSpeechAdapter {
  readonly mode = "streaming_audio" as const;

  private credentials() {
    const apiKey = process.env.FISH_AUDIO_API_KEY?.trim();
    if (!apiKey) throw new Error("FISH_AUDIO_API_KEY is not configured.");
    return {
      apiKey,
      model: process.env.FISH_AUDIO_TTS_MODEL?.trim() || "s2.1-pro",
      referenceId: process.env.FISH_AUDIO_REFERENCE_ID?.trim(),
    };
  }

  async synthesize(input: SpeechSynthesisInput): Promise<SpeechSynthesisResult> {
    const { apiKey, model, referenceId } = this.credentials();
    const started = Date.now();
    const format = input.format === "pcm" ? "pcm" : (input.format ?? "mp3");
    const response = await fetch(FISH_TTS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        model,
      },
      body: JSON.stringify({
        text: input.text,
        format,
        latency: "normal",
        reference_id: input.voice ?? referenceId,
      }),
      signal: input.signal ?? AbortSignal.timeout(45_000),
    });
    if (!response.ok) {
      throw apiError("Fish Audio TTS", response, await response.text().catch(() => ""));
    }
    return {
      bytes: Buffer.from(await response.arrayBuffer()),
      mimeType:
        response.headers.get("content-type")?.split(";")[0] ??
        (format === "pcm" ? "audio/pcm" : `audio/${format}`),
      utf8Bytes: Buffer.byteLength(input.text, "utf8"),
      characters: Array.from(input.text).length,
      latencyMs: Date.now() - started,
      routeId: "route_call_tts_fish",
    };
  }

  async openRealtimeSession(
    input: Omit<SpeechSynthesisInput, "text">,
  ): Promise<RealtimeTtsSession> {
    const { apiKey, model, referenceId } = this.credentials();
    const sampleRate = 24_000;
    const socket = new WebSocket(FISH_STREAMING_TTS_URL, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        model,
      },
    });
    const queue = createAudioQueue();
    let sequence = 0;
    let closed = false;
    let flushed = false;
    const fail = (error: Error) => {
      closed = true;
      queue.fail(error);
    };
    const send = (event: object) => {
      if (socket.readyState !== WebSocket.OPEN) {
        throw new Error("Fish Audio TTS session is not open.");
      }
      socket.send(encode(event));
    };

    socket.on("message", (raw: RawData) => {
      try {
        const bytes = Array.isArray(raw)
          ? Buffer.concat(raw)
          : Buffer.from(raw as ArrayBuffer);
        const event = decode(bytes) as {
          event?: string;
          audio?: Uint8Array;
          reason?: string;
          message?: string;
        };
        if (event.event === "audio" && event.audio) {
          queue.push({
            sequence: sequence++,
            bytes: event.audio,
            mimeType: "audio/pcm",
            sampleRate,
            channels: 1,
          });
        } else if (event.event === "finish") {
          closed = true;
          if (event.reason === "error") {
            queue.fail(new Error(event.message ?? "Fish Audio TTS failed."));
          } else {
            queue.finish();
          }
        }
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
    socket.on("error", (error) => fail(error));
    socket.on("close", () => {
      closed = true;
      queue.finish();
    });

    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    send({
      event: "start",
      request: {
        text: "",
        format: "pcm",
        sample_rate: sampleRate,
        chunk_length: 120,
        latency: "normal",
        reference_id: input.voice ?? referenceId,
      },
    });
    if (input.signal?.aborted) {
      socket.close(1000);
      throw input.signal.reason ?? new Error("Speech cancelled.");
    }

    const interrupt = async () => {
      if (closed) return;
      closed = true;
      socket.close(1000);
      queue.finish();
    };
    input.signal?.addEventListener("abort", () => void interrupt(), { once: true });

    return {
      chunks: queue.chunks,
      appendText: async (text) => {
        if (closed || flushed) throw new Error("Fish Audio TTS session is closed.");
        if (text.trim()) send({ event: "text", text });
      },
      flush: async () => {
        if (closed || flushed) return;
        flushed = true;
        send({ event: "stop" });
      },
      interrupt,
      close: async () => {
        if (!closed) {
          if (!flushed) send({ event: "stop" });
          socket.close(1000);
          closed = true;
          queue.finish();
        }
      },
    };
  }
}

export class XaiTtsAdapter implements TextToSpeechAdapter {
  readonly mode = "streaming_audio" as const;

  async synthesize(input: SpeechSynthesisInput): Promise<SpeechSynthesisResult> {
    const apiKey = process.env.XAI_API_KEY?.trim();
    if (!apiKey) throw new Error("XAI_API_KEY is not configured.");
    const started = Date.now();
    const response = await fetch(XAI_TTS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: input.text,
        voice_id: input.voice ?? "eve",
        language: input.locale ?? "en",
        output_format: {
          codec: input.format === "opus" ? "mp3" : (input.format ?? "mp3"),
        },
        speed: input.speed ?? 1,
        optimize_streaming_latency: 1,
      }),
      signal: input.signal ?? AbortSignal.timeout(45_000),
    });
    if (!response.ok) {
      throw apiError("xAI TTS", response, await response.text().catch(() => ""));
    }
    return {
      bytes: Buffer.from(await response.arrayBuffer()),
      mimeType: response.headers.get("content-type")?.split(";")[0] ?? "audio/mpeg",
      utf8Bytes: Buffer.byteLength(input.text, "utf8"),
      characters: Array.from(input.text).length,
      latencyMs: Date.now() - started,
      routeId: "route_call_tts_xai",
    };
  }

  async openStream(input: SpeechSynthesisInput): Promise<StreamingSpeechSession> {
    const session = await this.openRealtimeSession(input);
    await session.appendText(input.text);
    await session.flush();
    return {
      chunks: session.chunks,
      cancel: (reason) => session.interrupt(reason),
    };
  }

  async openRealtimeSession(
    input: Omit<SpeechSynthesisInput, "text">,
  ): Promise<RealtimeTtsSession> {
    const apiKey = process.env.XAI_API_KEY?.trim();
    if (!apiKey) throw new Error("XAI_API_KEY is not configured.");
    // Raw PCM is the only provider stream we forward chunk-for-chunk. Unlike
    // MP3, every network delta can be scheduled without needing a complete
    // codec frame or independently decodable file.
    const codec = "pcm";
    const sampleRate = 24_000;
    const params = new URLSearchParams({
      language: input.locale ?? "en",
      voice: input.voice ?? "eve",
      codec,
      sample_rate: String(sampleRate),
      speed: String(input.speed ?? 1),
      optimize_streaming_latency: "1",
    });
    const socket = new WebSocket(`${XAI_STREAMING_TTS_URL}?${params}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const queue = createAudioQueue();
    let sequence = 0;
    let flushed = false;
    let closed = false;
    const fail = (error: Error) => {
      closed = true;
      queue.fail(error);
    };

    socket.on("message", (data: RawData) => {
      try {
        const event = JSON.parse(data.toString()) as {
          type?: string;
          delta?: string;
          message?: string;
        };
        if (event.type === "audio.delta" && event.delta) {
          queue.push({
            sequence: sequence++,
            bytes: Buffer.from(event.delta, "base64"),
            mimeType: "audio/pcm",
            sampleRate,
            channels: 1,
          });
        } else if (event.type === "audio.done" || event.type === "audio.clear") {
          closed = true;
          queue.finish();
          socket.close(1000);
        } else if (event.type === "error") {
          fail(new Error(event.message ?? "xAI streaming TTS failed."));
        }
      } catch {
        fail(new Error("xAI streaming TTS returned an invalid event."));
      }
    });
    socket.on("error", (error) => fail(error));
    socket.on("close", () => {
      closed = true;
      queue.finish();
    });

    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        socket.off("error", onError);
        resolve();
      };
      const onError = (error: Error) => {
        socket.off("open", onOpen);
        reject(error);
      };
      socket.once("open", onOpen);
      socket.once("error", onError);
    });
    if (input.signal?.aborted) {
      socket.close(1000);
      throw input.signal.reason ?? new Error("Speech cancelled.");
    }
    const interrupt = async (reason?: string) => {
      if (closed) return;
      closed = true;
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "text.clear" }));
        socket.close(1000, reason?.slice(0, 120));
      }
      queue.finish();
    };
    input.signal?.addEventListener("abort", () => void interrupt("Speech cancelled."), {
      once: true,
    });

    return {
      chunks: queue.chunks,
      appendText: async (text) => {
        if (closed) throw new Error("TTS session is closed.");
        if (flushed) throw new Error("TTS session is already flushed.");
        if (text.trim()) {
          socket.send(JSON.stringify({ type: "text.delta", delta: text }));
        }
      },
      flush: async () => {
        if (closed || flushed) return;
        flushed = true;
        socket.send(JSON.stringify({ type: "text.done" }));
      },
      interrupt,
      close: async () => {
        if (closed) return;
        if (!flushed) {
          flushed = true;
          socket.send(JSON.stringify({ type: "text.done" }));
        }
        if (socket.readyState === WebSocket.OPEN) socket.close(1000);
        closed = true;
        queue.finish();
      },
    };
  }
}
