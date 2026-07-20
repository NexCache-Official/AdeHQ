import { SILICONFLOW_API_BASE_URL } from "@/lib/config/features";
import WebSocket, { type RawData } from "ws";
import type {
  FinalTranscript,
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
export const GROQ_MINIMUM_BILLABLE_SECONDS = 10;

function apiError(label: string, response: Response, body: string): Error {
  return new Error(`${label} failed (${response.status}): ${body.slice(0, 240)}`);
}

async function* streamResponse(
  response: Response,
  mimeType: string,
  signal?: AbortSignal,
): AsyncGenerator<SpeechAudioChunk> {
  if (!response.body) throw new Error("Speech provider returned no audio stream.");
  const reader = response.body.getReader();
  let sequence = 0;
  try {
    while (true) {
      if (signal?.aborted) throw signal.reason ?? new Error("Speech cancelled.");
      const { done, value } = await reader.read();
      if (done) break;
      if (value?.length) yield { sequence: sequence++, bytes: value, mimeType };
    }
  } finally {
    reader.releaseLock();
  }
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
    if (context.language) form.append("language", context.language);
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
    const controller = new AbortController();
    const response = await this.request({
      ...input,
      signal: input.signal ?? controller.signal,
    });
    const mimeType =
      response.headers.get("content-type")?.split(";")[0] ?? "audio/mpeg";
    return {
      chunks: streamResponse(response, mimeType, controller.signal),
      cancel: async (reason) => controller.abort(new Error(reason ?? "Speech interrupted.")),
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
    const apiKey = process.env.XAI_API_KEY?.trim();
    if (!apiKey) throw new Error("XAI_API_KEY is not configured.");
    const codec = input.format === "opus" ? "mp3" : (input.format ?? "mp3");
    const params = new URLSearchParams({
      language: input.locale ?? "en",
      voice: input.voice ?? "eve",
      codec,
      speed: String(input.speed ?? 1),
      optimize_streaming_latency: "1",
    });
    const socket = new WebSocket(`${XAI_STREAMING_TTS_URL}?${params}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const queue: SpeechAudioChunk[] = [];
    let sequence = 0;
    let completed = false;
    let failure: Error | null = null;
    let wake: (() => void) | null = null;
    const notify = () => {
      wake?.();
      wake = null;
    };
    const fail = (error: Error) => {
      failure = error;
      completed = true;
      notify();
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
            mimeType:
              codec === "wav"
                ? "audio/wav"
                : codec === "pcm"
                  ? "audio/pcm"
                  : "audio/mpeg",
          });
          notify();
        } else if (event.type === "audio.done" || event.type === "audio.clear") {
          completed = true;
          socket.close(1000);
          notify();
        } else if (event.type === "error") {
          fail(new Error(event.message ?? "xAI streaming TTS failed."));
        }
      } catch {
        fail(new Error("xAI streaming TTS returned an invalid event."));
      }
    });
    socket.on("error", (error) => fail(error));
    socket.on("close", () => {
      completed = true;
      notify();
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
    socket.send(JSON.stringify({ type: "text.delta", delta: input.text }));
    socket.send(JSON.stringify({ type: "text.done" }));

    const cancel = async (reason?: string) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "text.clear" }));
        socket.close(1000, reason?.slice(0, 120));
      }
      completed = true;
      notify();
    };
    input.signal?.addEventListener("abort", () => void cancel("Speech cancelled."), {
      once: true,
    });

    return {
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
      cancel,
    };
  }
}
