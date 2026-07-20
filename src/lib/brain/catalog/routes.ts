import type { BrainCapability, CapabilityUnitType } from "./capabilities";

/**
 * Route environment / lifecycle state.
 * - production: live scoring primary
 * - fallback: backup for a production primary (not scored as primary)
 * - shadow: approved candidate; may run invisibly; not live scoring
 * - evaluation: experimental shelf; never auto-scored
 * - disabled: reserved slot (e.g. STT) — not activatable until filled
 */
export type BrainRouteEnvironment =
  | "production"
  | "fallback"
  | "shadow"
  | "evaluation"
  | "disabled";

export type BrainProvider =
  | "siliconflow"
  | "groq"
  | "xai"
  | "vercel_gateway"
  | "tavily"
  | "perplexity"
  | "exa"
  | "browserbase"
  | "mock"
  | "unassigned";

/**
 * CapabilityRoute — provider/model implementation. NO prices on the route object.
 */
export type CapabilityRoute = {
  id: string;
  capability: BrainCapability;
  provider: BrainProvider;
  providerRoute:
    | "siliconflow_direct"
    | "groq_direct"
    | "xai_direct"
    | "vercel_gateway"
    | "mock"
    | null;
  model: string;
  gatewayProviderSlug?: string | null;
  unitType: CapabilityUnitType;
  environment: BrainRouteEnvironment;
  /** False only for disabled / incomplete reserved slots. */
  enabled: boolean;
  /** Human label for Control (never shown as a model SKU to members). */
  label: string;
  contextWindow?: number | null;
  supportsTools?: boolean;
  supportsVision?: boolean;
  supportsJson?: boolean;
  /** Primary route this backs up (fallback routes). */
  fallbackForRouteId?: string | null;
  /** Ordered backup route ids (on production primaries). */
  fallbackRouteIds?: string[];
  notes?: string;
};

export const BRAIN_ROUTES: CapabilityRoute[] = [
  // ─── Production text ─────────────────────────────────────────────
  {
    id: "route_text_v4flash_sf",
    capability: "reasoning",
    provider: "siliconflow",
    providerRoute: "siliconflow_direct",
    model: "deepseek-ai/DeepSeek-V4-Flash",
    unitType: "tokens",
    environment: "production",
    enabled: true,
    label: "Everyday employee work",
    contextWindow: 128_000,
    supportsTools: true,
    supportsJson: true,
    fallbackRouteIds: ["route_text_qwen3_8b_sf"],
  },
  {
    id: "route_text_v4flash_sf_quick",
    capability: "quick_reply",
    provider: "siliconflow",
    providerRoute: "siliconflow_direct",
    model: "deepseek-ai/DeepSeek-V4-Flash",
    unitType: "tokens",
    environment: "production",
    enabled: true,
    label: "Quick replies",
    contextWindow: 128_000,
    supportsTools: false,
    supportsJson: true,
    fallbackRouteIds: ["route_text_v4flash_sf"],
  },
  {
    id: "route_text_v4pro_vg",
    capability: "deep_reasoning",
    provider: "vercel_gateway",
    providerRoute: "vercel_gateway",
    model: "deepseek/deepseek-v4-pro",
    gatewayProviderSlug: "deepseek",
    unitType: "tokens",
    environment: "production",
    enabled: true,
    label: "Complex reasoning",
    contextWindow: 128_000,
    supportsTools: true,
    supportsJson: true,
    fallbackRouteIds: ["route_text_v4pro_sf_failover"],
  },
  {
    id: "route_text_v4pro_sf_failover",
    capability: "deep_reasoning",
    provider: "siliconflow",
    providerRoute: "siliconflow_direct",
    model: "deepseek-ai/DeepSeek-V4-Pro",
    unitType: "tokens",
    environment: "fallback",
    enabled: true,
    label: "Strong reasoning backup (SF)",
    contextWindow: 128_000,
    supportsTools: true,
    supportsJson: true,
    fallbackForRouteId: "route_text_v4pro_vg",
    notes: "Much more expensive than Gateway — only when primary fails.",
  },
  {
    id: "route_text_minimax_m25_vg",
    capability: "long_context",
    provider: "vercel_gateway",
    providerRoute: "vercel_gateway",
    model: "minimax/minimax-m2.5",
    gatewayProviderSlug: "deepinfra",
    unitType: "tokens",
    environment: "production",
    enabled: true,
    label: "Long context (DeepInfra)",
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsJson: true,
    fallbackRouteIds: [
      "route_text_minimax_m25_vg_native",
      "route_text_minimax_m25_sf",
    ],
  },
  {
    id: "route_text_minimax_m25_vg_native",
    capability: "long_context",
    provider: "vercel_gateway",
    providerRoute: "vercel_gateway",
    model: "minimax/minimax-m2.5",
    gatewayProviderSlug: "minimax",
    unitType: "tokens",
    environment: "fallback",
    enabled: true,
    label: "Long context (native Gateway)",
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsJson: true,
    fallbackForRouteId: "route_text_minimax_m25_vg",
  },
  {
    id: "route_text_minimax_m25_sf",
    capability: "long_context",
    provider: "siliconflow",
    providerRoute: "siliconflow_direct",
    model: "MiniMaxAI/MiniMax-M2.5",
    unitType: "tokens",
    environment: "fallback",
    enabled: true,
    label: "Long context (SiliconFlow)",
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsJson: true,
    fallbackForRouteId: "route_text_minimax_m25_vg",
  },
  {
    id: "route_text_qwen3_coder_sf",
    capability: "coding",
    provider: "siliconflow",
    providerRoute: "siliconflow_direct",
    model: "Qwen/Qwen3-Coder-30B-A3B-Instruct",
    unitType: "tokens",
    environment: "production",
    enabled: true,
    label: "Coding",
    contextWindow: 128_000,
    supportsTools: true,
    supportsJson: true,
    fallbackRouteIds: ["route_eval_kimi_k27_code"],
  },
  {
    id: "route_text_qwen3_8b_sf",
    capability: "classification",
    provider: "siliconflow",
    providerRoute: "siliconflow_direct",
    model: "Qwen/Qwen3-8B",
    unitType: "tokens",
    environment: "production",
    enabled: true,
    label: "Basic chat / classifier failover",
    contextWindow: 32_768,
    supportsTools: false,
    supportsJson: true,
    fallbackRouteIds: [],
    notes: "Production classifier until Step-3.5-Flash wins shadow eval (PR-13).",
  },
  {
    id: "route_embed_qwen3_sf",
    capability: "embedding",
    provider: "siliconflow",
    providerRoute: "siliconflow_direct",
    model: "Qwen/Qwen3-Embedding-0.6B",
    unitType: "tokens",
    environment: "production",
    enabled: true,
    label: "Embeddings",
    contextWindow: 8_192,
    supportsTools: false,
    supportsJson: false,
    fallbackRouteIds: [],
  },

  // ─── Production search / browser (PR-14 Exa-first) ───────────────
  {
    id: "route_search_exa",
    capability: "search_semantic",
    provider: "exa",
    providerRoute: null,
    model: "exa-search",
    unitType: "search",
    environment: "production",
    enabled: true,
    label: "Exa web retrieval (primary)",
    fallbackRouteIds: ["route_search_perplexity", "route_search_tavily"],
    notes:
      "PR-14 primary for current facts, company/market/people research, docs, papers, semantic discovery.",
  },
  {
    id: "route_search_perplexity",
    capability: "search_fast",
    provider: "perplexity",
    providerRoute: null,
    model: "perplexity-search",
    unitType: "search",
    environment: "production",
    enabled: true,
    label: "Perplexity grounded answer (fallback)",
    fallbackRouteIds: ["route_search_tavily"],
    notes: "PR-14 first fallback when Exa fails or evidence is insufficient.",
  },
  {
    id: "route_search_tavily",
    capability: "research_planning",
    provider: "tavily",
    providerRoute: null,
    model: "tavily-search",
    unitType: "search",
    environment: "production",
    enabled: true,
    label: "Tavily search (final fallback)",
    fallbackRouteIds: [],
    notes: "PR-14 final non-browser fallback / extraction hedge.",
  },
  {
    id: "route_browser_browserbase",
    capability: "browser_research",
    provider: "browserbase",
    providerRoute: null,
    model: "browserbase-session",
    unitType: "browser_second",
    environment: "production",
    enabled: true,
    label: "Browser automation",
    fallbackRouteIds: [],
    notes: "Interaction-only — never ordinary fact fallback.",
  },
  {
    id: "route_vision_qwen3_vl_8b_sf",
    capability: "vision",
    provider: "siliconflow",
    providerRoute: "siliconflow_direct",
    model: "Qwen/Qwen3-VL-8B-Instruct",
    unitType: "tokens",
    environment: "production",
    enabled: true,
    label: "Standard visual understanding",
    contextWindow: 32_768,
    supportsVision: true,
    supportsJson: true,
    fallbackRouteIds: ["route_vision_qwen3_vl_32b_sf"],
    notes: "PR-15 primary vision. Escalate to VL-32B-Thinking only when confidence is insufficient.",
  },
  {
    id: "route_vision_qwen3_vl_32b_sf",
    capability: "vision",
    provider: "siliconflow",
    providerRoute: "siliconflow_direct",
    model: "Qwen/Qwen3-VL-32B-Thinking",
    unitType: "tokens",
    environment: "production",
    enabled: true,
    label: "Difficult visual reasoning",
    contextWindow: 32_768,
    supportsVision: true,
    supportsJson: true,
    fallbackForRouteId: "route_vision_qwen3_vl_8b_sf",
    notes: "PR-15 complex visual reasoning / escalation from VL-8B.",
  },
  {
    id: "route_image_z_image_turbo",
    capability: "image_generation",
    provider: "siliconflow",
    providerRoute: "siliconflow_direct",
    model: "Tongyi-MAI/Z-Image-Turbo",
    unitType: "image",
    environment: "production",
    enabled: true,
    label: "Create image",
    notes: "PR-16 quick image — 0.5 WH/image. Member label only; never expose model SKU.",
  },
  {
    id: "route_image_qwen_image",
    capability: "image_generation",
    provider: "siliconflow",
    providerRoute: "siliconflow_direct",
    model: "Qwen/Qwen-Image",
    unitType: "image",
    environment: "production",
    enabled: true,
    label: "Create business graphic",
    notes: "PR-16 text-heavy business graphic — 2 WH/image.",
  },
  {
    id: "route_image_qwen_image_edit",
    capability: "image_edit",
    provider: "siliconflow",
    providerRoute: "siliconflow_direct",
    model: "Qwen/Qwen-Image-Edit",
    unitType: "image",
    environment: "production",
    enabled: true,
    label: "Edit image",
    notes: "PR-16 edit uploaded / prior image — 4 WH/image.",
  },
  {
    id: "route_image_flux2_flex",
    capability: "image_generation",
    provider: "siliconflow",
    providerRoute: "siliconflow_direct",
    model: "black-forest-labs/FLUX.2-flex",
    unitType: "image",
    environment: "production",
    enabled: true,
    label: "Create premium visual",
    notes: "PR-16 premium visual — 6 WH/image. Always show WH estimate before generate.",
  },
  {
    id: "route_video_wan22_t2v",
    capability: "video_generation",
    provider: "siliconflow",
    providerRoute: "siliconflow_direct",
    model: "Wan-AI/Wan2.2-T2V-A14B",
    unitType: "video",
    environment: "production",
    enabled: true,
    label: "Create video from text",
    notes: "PR-17 five-second T2V — 29 WH/video. Approval required. Async + cancellable locally.",
  },
  {
    id: "route_video_wan22_i2v",
    capability: "video_generation",
    provider: "siliconflow",
    providerRoute: "siliconflow_direct",
    model: "Wan-AI/Wan2.2-I2V-A14B",
    unitType: "video",
    environment: "production",
    enabled: true,
    label: "Create video from image",
    notes: "PR-17 five-second I2V — 29 WH/video. Approval required. Link source image artifact.",
  },

  // ─── Shadow — approved candidates, NOT live scoring ──────────────
  {
    id: "route_classify_step35_flash_sf",
    capability: "classification",
    provider: "siliconflow",
    providerRoute: "siliconflow_direct",
    model: "stepfun-ai/Step-3.5-Flash",
    unitType: "tokens",
    environment: "shadow",
    enabled: true,
    label: "Micro-routing / classification candidate",
    contextWindow: 262_144,
    supportsTools: false,
    supportsJson: false,
    notes:
      "PR-13 shadow eval vs Qwen3-8B. SF rejects response_format=json_object; use text+parse + enable_thinking=false. Do not promote without proof.",
  },
  {
    id: "route_tts_cosyvoice2",
    capability: "text_to_speech",
    provider: "siliconflow",
    providerRoute: "siliconflow_direct",
    model: "FunAudioLLM/CosyVoice2-0.5B",
    unitType: "utf8_bytes",
    environment: "production",
    enabled: true,
    label: "Read aloud",
    notes: "PR-18 default TTS. Member label only — never expose model name.",
  },
  {
    id: "route_tts_indextts2",
    capability: "text_to_speech",
    provider: "siliconflow",
    providerRoute: "siliconflow_direct",
    model: "IndexTeam/IndexTTS-2",
    unitType: "utf8_bytes",
    environment: "production",
    enabled: true,
    label: "Generate narration",
    notes: "PR-18 expressive / timed narration.",
  },
  {
    id: "route_tts_fish_speech",
    capability: "text_to_speech",
    provider: "siliconflow",
    providerRoute: "siliconflow_direct",
    model: "fishaudio/fish-speech-1.5",
    unitType: "utf8_bytes",
    environment: "production",
    enabled: true,
    label: "Create premium voiceover",
    notes: "PR-18 premium multilingual — gated by workspace premiumVoicesAllowed.",
  },
  {
    id: "route_call_tts_xai",
    capability: "text_to_speech",
    provider: "xai",
    providerRoute: "xai_direct",
    model: "xai-tts",
    unitType: "utf8_bytes",
    environment: "fallback",
    enabled: true,
    label: "Premium voice",
    fallbackForRouteId: "route_tts_cosyvoice2",
    notes: "PR-18.1 premium/fallback TTS. Direct xAI endpoint; never Gateway TTS.",
  },

  // ─── Evaluation — never auto-scored ──────────────────────────────
  {
    id: "route_eval_kimi_k27_code",
    capability: "coding",
    provider: "siliconflow",
    providerRoute: "siliconflow_direct",
    model: "moonshotai/Kimi-K2.7-Code",
    unitType: "tokens",
    environment: "evaluation",
    enabled: true,
    label: "Coding escalation candidate",
    contextWindow: 256_000,
    supportsTools: true,
    supportsJson: true,
    fallbackForRouteId: "route_text_qwen3_coder_sf",
    notes: "Promote to fallback only if it wins real coding tests.",
  },
  {
    id: "route_eval_qwen36_35b",
    capability: "reasoning",
    provider: "siliconflow",
    providerRoute: "siliconflow_direct",
    model: "Qwen/Qwen3.6-35B-A3B",
    unitType: "tokens",
    environment: "evaluation",
    enabled: true,
    label: "Qwen3.6-35B challenger",
    contextWindow: 128_000,
    supportsTools: true,
    supportsVision: true,
    supportsJson: true,
  },
  {
    id: "route_eval_qwen36_27b",
    capability: "reasoning",
    provider: "siliconflow",
    providerRoute: "siliconflow_direct",
    model: "Qwen/Qwen3.6-27B",
    unitType: "tokens",
    environment: "evaluation",
    enabled: true,
    label: "Qwen3.6-27B dense comparison",
    contextWindow: 128_000,
    supportsTools: true,
    supportsJson: true,
    notes: "Do not activate by default — expensive vs peers.",
  },
  {
    id: "route_eval_glm52",
    capability: "deep_reasoning",
    provider: "siliconflow",
    providerRoute: "siliconflow_direct",
    model: "zai-org/GLM-5.2",
    unitType: "tokens",
    environment: "evaluation",
    enabled: true,
    label: "GLM-5.2 premium agentic",
    contextWindow: 200_000,
    supportsTools: true,
    supportsJson: true,
  },
  {
    id: "route_eval_minimax_m3",
    capability: "long_context",
    provider: "siliconflow",
    providerRoute: "siliconflow_direct",
    model: "MiniMaxAI/MiniMax-M3",
    unitType: "tokens",
    environment: "evaluation",
    enabled: true,
    label: "MiniMax M3 challenger",
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsVision: true,
    supportsJson: true,
    notes: "Under-512K rates in default snapshot; over-512K is a separate snapshot when needed.",
  },

  // ─── STT — selected after SiliconFlow transcription eval (PR-18) ─
  {
    id: "route_stt_fast",
    capability: "speech_to_text",
    provider: "siliconflow",
    providerRoute: "siliconflow_direct",
    model: "FunAudioLLM/SenseVoiceSmall",
    unitType: "audio_seconds",
    environment: "production",
    enabled: true,
    label: "Voice note transcription",
    notes: "Fast path for ordinary voice notes. Escalate on quality/diarization need.",
  },
  {
    id: "route_stt_accurate",
    capability: "speech_to_text",
    provider: "siliconflow",
    providerRoute: "siliconflow_direct",
    model: "TeleAI/TeleSpeechASR",
    unitType: "audio_seconds",
    environment: "production",
    enabled: true,
    label: "Accurate transcription",
    notes: "Escalation for noisy audio, accents, technical terminology.",
  },
  {
    id: "route_stt_diarized",
    capability: "speech_to_text",
    provider: "siliconflow",
    providerRoute: "siliconflow_direct",
    model: "FunAudioLLM/SenseVoiceSmall",
    unitType: "audio_seconds",
    environment: "shadow",
    enabled: true,
    label: "Meeting transcription",
    notes: "Diarization V1: segment scaffolding + speaker labels when provider supports; shadow until benchmark gate.",
  },
  {
    id: "route_call_stt_groq_turbo",
    capability: "speech_to_text",
    provider: "groq",
    providerRoute: "groq_direct",
    model: "whisper-large-v3-turbo",
    unitType: "audio_seconds",
    environment: "production",
    enabled: true,
    label: "Fast call transcription",
    fallbackRouteIds: ["route_call_stt_groq_accurate", "route_stt_fast"],
    notes: "PR-18.1 batch utterance STT. Ten-second minimum billed per request; never expose fake partials.",
  },
  {
    id: "route_call_stt_groq_accurate",
    capability: "speech_to_text",
    provider: "groq",
    providerRoute: "groq_direct",
    model: "whisper-large-v3",
    unitType: "audio_seconds",
    environment: "fallback",
    enabled: true,
    label: "Accurate call transcription",
    fallbackForRouteId: "route_call_stt_groq_turbo",
    notes: "Selective retry for low-confidence, noisy, accented, or terminology-heavy utterances.",
  },
];

export function getBrainRoute(routeId: string): CapabilityRoute | undefined {
  return BRAIN_ROUTES.find((r) => r.id === routeId);
}

export function listBrainRoutes(options?: {
  environment?: BrainRouteEnvironment | BrainRouteEnvironment[];
  capability?: BrainCapability;
  enabledOnly?: boolean;
  /** When true, only routes eligible for production scoring. */
  productionScoringOnly?: boolean;
}): CapabilityRoute[] {
  const envs = options?.environment
    ? Array.isArray(options.environment)
      ? options.environment
      : [options.environment]
    : null;

  return BRAIN_ROUTES.filter((r) => {
    if (options?.productionScoringOnly && r.environment !== "production") return false;
    if (envs && !envs.includes(r.environment)) return false;
    if (options?.capability && r.capability !== options.capability) return false;
    if (options?.enabledOnly && !r.enabled) return false;
    return true;
  });
}

/** Resolve a Brain route id from runtime provider + model (best effort). */
export function resolveRouteIdForModel(input: {
  modelId?: string | null;
  providerRoute?: string | null;
  capability?: BrainCapability | null;
}): string | null {
  const modelId = input.modelId?.trim();
  if (!modelId) return null;
  const matches = BRAIN_ROUTES.filter(
    (r) =>
      r.model === modelId &&
      r.environment !== "disabled" &&
      (input.providerRoute == null ||
        r.providerRoute == null ||
        r.providerRoute === input.providerRoute),
  );
  if (input.capability) {
    const byCap = matches.find((r) => r.capability === input.capability);
    if (byCap) return byCap.id;
  }
  const production = matches.find((r) => r.environment === "production");
  return (production ?? matches[0])?.id ?? null;
}

export function getFallbackChain(routeId: string): CapabilityRoute[] {
  const primary = getBrainRoute(routeId);
  if (!primary?.fallbackRouteIds?.length) return [];
  return primary.fallbackRouteIds
    .map((id) => getBrainRoute(id))
    .filter((r): r is CapabilityRoute => Boolean(r));
}
