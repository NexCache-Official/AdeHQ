export type BenchmarkStage = "stt" | "tts";
export type BenchmarkAudioFormat = "pcm_s16le" | "mp3" | "wav" | "opus";
export type BenchmarkCostUnit = "million_characters" | "audio_hour";

export interface VoiceBenchmarkCandidate {
  id: string;
  label: string;
  stage: BenchmarkStage;
  family: "managed" | "self_hosted";
  keyEnv?: string;
  endpointEnv: string;
  defaultEndpoint?: string;
  model?: string;
  outputFormat?: BenchmarkAudioFormat;
  extraEnv?: string[];
  costPerUnitEnv: string;
  costUnit: BenchmarkCostUnit;
}

export const voiceBenchmarkCandidates: readonly VoiceBenchmarkCandidate[] = [
  {
    id: "xai-stt",
    label: "xAI STT",
    stage: "stt",
    family: "managed",
    keyEnv: "XAI_API_KEY",
    endpointEnv: "XAI_STT_ENDPOINT",
    model: "xai-stt",
    costPerUnitEnv: "VOICE_BENCHMARK_XAI_STT_USD_PER_AUDIO_HOUR",
    costUnit: "audio_hour",
  },
  {
    id: "deepgram-flux-stt",
    label: "Deepgram Flux",
    stage: "stt",
    family: "managed",
    keyEnv: "DEEPGRAM_API_KEY",
    endpointEnv: "DEEPGRAM_STT_ENDPOINT",
    model: "flux-general-en",
    costPerUnitEnv: "VOICE_BENCHMARK_DEEPGRAM_FLUX_USD_PER_AUDIO_HOUR",
    costUnit: "audio_hour",
  },
  {
    id: "xai-tts",
    label: "xAI TTS",
    stage: "tts",
    family: "managed",
    keyEnv: "XAI_API_KEY",
    endpointEnv: "XAI_TTS_ENDPOINT",
    defaultEndpoint: "https://api.x.ai/v1/tts",
    model: "xai-tts",
    outputFormat: "mp3",
    costPerUnitEnv: "VOICE_BENCHMARK_XAI_TTS_USD_PER_MILLION_CHARACTERS",
    costUnit: "million_characters",
  },
  {
    id: "fish-s2.1-pro-tts",
    label: "Fish Audio S2.1 Pro",
    stage: "tts",
    family: "managed",
    keyEnv: "FISH_AUDIO_API_KEY",
    endpointEnv: "FISH_TTS_ENDPOINT",
    defaultEndpoint: "https://api.fish.audio/v1/tts",
    model: "s2.1-pro",
    outputFormat: "mp3",
    costPerUnitEnv: "VOICE_BENCHMARK_FISH_S21_PRO_USD_PER_MILLION_CHARACTERS",
    costUnit: "million_characters",
  },
  {
    id: "cartesia-sonic-3.5-tts",
    label: "Cartesia Sonic 3.5",
    stage: "tts",
    family: "managed",
    keyEnv: "CARTESIA_API_KEY",
    endpointEnv: "CARTESIA_TTS_ENDPOINT",
    defaultEndpoint: "https://api.cartesia.ai/tts/bytes",
    model: "sonic-3.5",
    outputFormat: "pcm_s16le",
    extraEnv: ["CARTESIA_VOICE_ID"],
    costPerUnitEnv: "VOICE_BENCHMARK_CARTESIA_SONIC35_USD_PER_MILLION_CHARACTERS",
    costUnit: "million_characters",
  },
  {
    id: "elevenlabs-flash-2.5-tts",
    label: "ElevenLabs Flash 2.5",
    stage: "tts",
    family: "managed",
    keyEnv: "ELEVENLABS_API_KEY",
    endpointEnv: "ELEVENLABS_TTS_ENDPOINT",
    model: "eleven_flash_v2_5",
    outputFormat: "mp3",
    costPerUnitEnv: "VOICE_BENCHMARK_ELEVENLABS_FLASH25_USD_PER_MILLION_CHARACTERS",
    costUnit: "million_characters",
  },
  {
    id: "fish-s2-endpoint",
    label: "Fish Audio S2 (self-hosted)",
    stage: "tts",
    family: "self_hosted",
    endpointEnv: "FISH_S2_ENDPOINT",
    model: "fish-s2",
    outputFormat: "pcm_s16le",
    costPerUnitEnv: "VOICE_BENCHMARK_FISH_S2_ENDPOINT_USD_PER_AUDIO_HOUR",
    costUnit: "audio_hour",
  },
  {
    id: "qwen3-tts-endpoint",
    label: "Qwen3-TTS (self-hosted)",
    stage: "tts",
    family: "self_hosted",
    endpointEnv: "QWEN3_TTS_ENDPOINT",
    model: "qwen3-tts",
    outputFormat: "pcm_s16le",
    costPerUnitEnv: "VOICE_BENCHMARK_QWEN3_TTS_ENDPOINT_USD_PER_AUDIO_HOUR",
    costUnit: "audio_hour",
  },
  {
    id: "cosyvoice2-endpoint",
    label: "CosyVoice 2 (self-hosted)",
    stage: "tts",
    family: "self_hosted",
    endpointEnv: "COSYVOICE2_ENDPOINT",
    model: "cosyvoice2",
    outputFormat: "pcm_s16le",
    costPerUnitEnv: "VOICE_BENCHMARK_COSYVOICE2_ENDPOINT_USD_PER_AUDIO_HOUR",
    costUnit: "audio_hour",
  },
  {
    id: "kokoro-endpoint",
    label: "Kokoro (self-hosted)",
    stage: "tts",
    family: "self_hosted",
    endpointEnv: "KOKORO_ENDPOINT",
    model: "kokoro",
    outputFormat: "pcm_s16le",
    costPerUnitEnv: "VOICE_BENCHMARK_KOKORO_ENDPOINT_USD_PER_AUDIO_HOUR",
    costUnit: "audio_hour",
  },
  {
    id: "moonshine-v2-endpoint",
    label: "Moonshine v2 (self-hosted)",
    stage: "stt",
    family: "self_hosted",
    endpointEnv: "MOONSHINE_ENDPOINT",
    model: "moonshine-v2",
    costPerUnitEnv: "VOICE_BENCHMARK_MOONSHINE_V2_ENDPOINT_USD_PER_AUDIO_HOUR",
    costUnit: "audio_hour",
  },
  {
    id: "whisper-cpp-endpoint",
    label: "whisper.cpp (self-hosted)",
    stage: "stt",
    family: "self_hosted",
    endpointEnv: "WHISPER_CPP_ENDPOINT",
    model: "whisper.cpp",
    costPerUnitEnv: "VOICE_BENCHMARK_WHISPER_CPP_ENDPOINT_USD_PER_AUDIO_HOUR",
    costUnit: "audio_hour",
  },
  {
    id: "faster-whisper-endpoint",
    label: "faster-whisper (self-hosted)",
    stage: "stt",
    family: "self_hosted",
    endpointEnv: "FASTER_WHISPER_ENDPOINT",
    model: "faster-whisper",
    costPerUnitEnv: "VOICE_BENCHMARK_FASTER_WHISPER_ENDPOINT_USD_PER_AUDIO_HOUR",
    costUnit: "audio_hour",
  },
] as const;

export function candidateConfiguration(
  candidate: VoiceBenchmarkCandidate,
  env: NodeJS.ProcessEnv,
): { endpoint?: string; key?: string; missing: string[] } {
  const endpoint = env[candidate.endpointEnv] || candidate.defaultEndpoint;
  const key = candidate.keyEnv ? env[candidate.keyEnv] : undefined;
  const missing = [
    ...(!endpoint ? [candidate.endpointEnv] : []),
    ...(candidate.keyEnv && !key ? [candidate.keyEnv] : []),
    ...(candidate.extraEnv ?? []).filter((name) => !env[name]),
  ];
  return { endpoint, key, missing };
}
