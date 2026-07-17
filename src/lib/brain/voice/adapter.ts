import { SILICONFLOW_API_BASE_URL } from "@/lib/config/features";
import { getBrainRoute } from "@/lib/brain/catalog";
import type { SpeechToTextSegment, SttRouteId, TtsRouteId } from "./types";

const DEFAULT_VOICE_BY_ROUTE: Record<TtsRouteId, string> = {
  route_tts_cosyvoice2: "FunAudioLLM/CosyVoice2-0.5B:alex",
  route_tts_indextts2: "IndexTeam/IndexTTS-2:default",
  route_tts_fish_speech: "fishaudio/fish-speech-1.5:alex",
};

export async function callSiliconFlowTts(params: {
  routeId: TtsRouteId;
  text: string;
  voice?: string;
  responseFormat?: "mp3" | "wav" | "opus" | "pcm";
  speed?: number;
  timeoutMs?: number;
  apiKey?: string;
  baseURL?: string;
}): Promise<{ bytes: Buffer; mimeType: string; latencyMs: number; modelId: string }> {
  const route = getBrainRoute(params.routeId);
  if (!route?.model) throw new Error(`Unknown TTS route ${params.routeId}`);
  const apiKey = (params.apiKey ?? process.env.SILICONFLOW_API_KEY)?.trim();
  if (!apiKey) throw new Error("SILICONFLOW_API_KEY is not configured.");
  const baseURL = (params.baseURL ?? SILICONFLOW_API_BASE_URL).replace(/\/$/, "");
  const started = Date.now();

  const response = await fetch(`${baseURL}/audio/speech`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: route.model,
      input: params.text,
      voice: params.voice || DEFAULT_VOICE_BY_ROUTE[params.routeId],
      response_format: params.responseFormat ?? "mp3",
      speed: params.speed ?? 1,
    }),
    signal: AbortSignal.timeout(params.timeoutMs ?? 90_000),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`TTS failed (${response.status}): ${errText.slice(0, 240)}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const mimeType =
    response.headers.get("content-type")?.split(";")[0]?.trim() || "audio/mpeg";
  return {
    bytes,
    mimeType,
    latencyMs: Date.now() - started,
    modelId: route.model,
  };
}

export async function callSiliconFlowStt(params: {
  routeId: SttRouteId;
  audioBytes: Buffer;
  fileName?: string;
  mimeType?: string;
  timeoutMs?: number;
  apiKey?: string;
  baseURL?: string;
}): Promise<{
  transcript: string;
  language?: string;
  latencyMs: number;
  modelId: string;
  raw: unknown;
}> {
  const route = getBrainRoute(params.routeId);
  if (!route?.model) throw new Error(`Unknown STT route ${params.routeId}`);
  const apiKey = (params.apiKey ?? process.env.SILICONFLOW_API_KEY)?.trim();
  if (!apiKey) throw new Error("SILICONFLOW_API_KEY is not configured.");
  const baseURL = (params.baseURL ?? SILICONFLOW_API_BASE_URL).replace(/\/$/, "");
  const started = Date.now();

  const form = new FormData();
  const blob = new Blob([new Uint8Array(params.audioBytes)], {
    type: params.mimeType || "audio/webm",
  });
  form.append("file", blob, params.fileName || "audio.webm");
  form.append("model", route.model);

  const response = await fetch(`${baseURL}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(params.timeoutMs ?? 120_000),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`STT failed (${response.status}): ${errText.slice(0, 240)}`);
  }

  const raw = (await response.json()) as Record<string, unknown>;
  const transcript =
    typeof raw.text === "string"
      ? raw.text
      : typeof raw.transcript === "string"
        ? raw.transcript
        : "";
  const language = typeof raw.language === "string" ? raw.language : undefined;

  return {
    transcript: transcript.trim(),
    language,
    latencyMs: Date.now() - started,
    modelId: route.model,
    raw,
  };
}

/**
 * Build segments when the provider returns only plain text.
 * Diarization-capable providers may later populate speakerId.
 */
export function buildSegmentsFromTranscript(
  transcript: string,
  durationSeconds: number,
  speakerLabels?: string[],
): SpeechToTextSegment[] {
  const sentences = transcript
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!sentences.length) {
    return [
      {
        startMs: 0,
        endMs: Math.max(0, Math.round(durationSeconds * 1000)),
        text: transcript,
      },
    ];
  }
  const totalChars = sentences.reduce((n, s) => n + s.length, 0) || 1;
  let cursor = 0;
  return sentences.map((text, i) => {
    const share = text.length / totalChars;
    const startMs = Math.round(cursor * 1000);
    cursor += share * durationSeconds;
    const endMs = Math.round(cursor * 1000);
    const speakerId =
      speakerLabels && speakerLabels.length
        ? speakerLabels[i % speakerLabels.length]
        : undefined;
    return { startMs, endMs, text, speakerId };
  });
}
