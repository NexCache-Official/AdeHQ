/**
 * Typed accessors + in-memory seed for brain_pricing_snapshots.
 * DB is the billing authority once migrated; seed is used at boot / offline / tests
 * and as the promote source for Control.
 */

export type PricingSnapshotSource = "manual" | "vercel_sync" | "siliconflow_sync" | "seed";

export type BrainPricingSnapshot = {
  id: string;
  routeId: string;
  currency: "USD";
  effectiveFrom: string;
  effectiveTo: string | null;
  inputPerMillion: number | null;
  outputPerMillion: number | null;
  cachedInputPerMillion: number | null;
  perImage: number | null;
  perVideo: number | null;
  perThousandUtf8Bytes: number | null;
  /** Character-priced speech routes (for example direct xAI TTS). */
  perThousandCharacters?: number | null;
  perSearchRequest: number | null;
  perBrowserSecond: number | null;
  perAudioSecond: number | null;
  source: PricingSnapshotSource;
  notes?: string;
};

const SEED_EFFECTIVE_FROM = "2026-07-16T00:00:00.000Z";

function tokenSnap(
  id: string,
  routeId: string,
  input: number,
  output: number,
  cached?: number,
  notes?: string,
): BrainPricingSnapshot {
  return {
    id,
    routeId,
    currency: "USD",
    effectiveFrom: SEED_EFFECTIVE_FROM,
    effectiveTo: null,
    inputPerMillion: input,
    outputPerMillion: output,
    cachedInputPerMillion: cached ?? input,
    perImage: null,
    perVideo: null,
    perThousandUtf8Bytes: null,
    perSearchRequest: null,
    perBrowserSecond: null,
    perAudioSecond: null,
    source: "seed",
    notes,
  };
}

function imageSnap(id: string, routeId: string, perImage: number): BrainPricingSnapshot {
  return {
    id,
    routeId,
    currency: "USD",
    effectiveFrom: SEED_EFFECTIVE_FROM,
    effectiveTo: null,
    inputPerMillion: null,
    outputPerMillion: null,
    cachedInputPerMillion: null,
    perImage,
    perVideo: null,
    perThousandUtf8Bytes: null,
    perSearchRequest: null,
    perBrowserSecond: null,
    perAudioSecond: null,
    source: "seed",
  };
}

function videoSnap(id: string, routeId: string, perVideo: number): BrainPricingSnapshot {
  return {
    id,
    routeId,
    currency: "USD",
    effectiveFrom: SEED_EFFECTIVE_FROM,
    effectiveTo: null,
    inputPerMillion: null,
    outputPerMillion: null,
    cachedInputPerMillion: null,
    perImage: null,
    perVideo,
    perThousandUtf8Bytes: null,
    perSearchRequest: null,
    perBrowserSecond: null,
    perAudioSecond: null,
    source: "seed",
  };
}

function ttsSnap(id: string, routeId: string, perThousandUtf8Bytes: number): BrainPricingSnapshot {
  return {
    id,
    routeId,
    currency: "USD",
    effectiveFrom: SEED_EFFECTIVE_FROM,
    effectiveTo: null,
    inputPerMillion: null,
    outputPerMillion: null,
    cachedInputPerMillion: null,
    perImage: null,
    perVideo: null,
    perThousandUtf8Bytes,
    perSearchRequest: null,
    perBrowserSecond: null,
    perAudioSecond: null,
    source: "seed",
  };
}

function ttsCharacterSnap(
  id: string,
  routeId: string,
  perThousandCharacters: number,
): BrainPricingSnapshot {
  return {
    ...ttsSnap(id, routeId, 0),
    perThousandUtf8Bytes: null,
    perThousandCharacters,
  };
}

function sttSnap(id: string, routeId: string, perAudioSecond: number): BrainPricingSnapshot {
  return {
    id,
    routeId,
    currency: "USD",
    effectiveFrom: SEED_EFFECTIVE_FROM,
    effectiveTo: null,
    inputPerMillion: null,
    outputPerMillion: null,
    cachedInputPerMillion: null,
    perImage: null,
    perVideo: null,
    perThousandUtf8Bytes: null,
    perSearchRequest: null,
    perBrowserSecond: null,
    perAudioSecond,
    source: "seed",
  };
}

function searchSnap(id: string, routeId: string, perSearchRequest: number): BrainPricingSnapshot {
  return {
    id,
    routeId,
    currency: "USD",
    effectiveFrom: SEED_EFFECTIVE_FROM,
    effectiveTo: null,
    inputPerMillion: null,
    outputPerMillion: null,
    cachedInputPerMillion: null,
    perImage: null,
    perVideo: null,
    perThousandUtf8Bytes: null,
    perSearchRequest,
    perBrowserSecond: null,
    perAudioSecond: null,
    source: "seed",
  };
}

/** Immutable seed snapshots — one live row per priced route (not disabled STT). */
export const SEEDED_PRICING_SNAPSHOTS: BrainPricingSnapshot[] = [
  // Production text
  tokenSnap("ps_v4flash_sf_2026-07-16", "route_text_v4flash_sf", 0.13, 0.28, 0.028),
  tokenSnap("ps_v4flash_sf_quick_2026-07-16", "route_text_v4flash_sf_quick", 0.13, 0.28, 0.028),
  tokenSnap("ps_v4pro_vg_2026-07-16", "route_text_v4pro_vg", 0.43, 0.87),
  tokenSnap("ps_v4pro_sf_2026-07-16", "route_text_v4pro_sf_failover", 1.5016, 3.135, 0.135),
  tokenSnap("ps_minimax_m25_vg_2026-07-16", "route_text_minimax_m25_vg", 0.27, 0.95),
  tokenSnap("ps_minimax_m25_vg_native_2026-07-16", "route_text_minimax_m25_vg_native", 0.3, 1.2),
  tokenSnap("ps_minimax_m25_sf_2026-07-16", "route_text_minimax_m25_sf", 0.3, 1.2, 0.03),
  tokenSnap("ps_qwen3_coder_sf_2026-07-16", "route_text_qwen3_coder_sf", 0.5, 1.0),
  tokenSnap("ps_qwen3_8b_sf_2026-07-16", "route_text_qwen3_8b_sf", 0.06, 0.06),
  tokenSnap("ps_embed_qwen3_sf_2026-07-16", "route_embed_qwen3_sf", 0.02, 0.02),

  // Production search / browser
  searchSnap("ps_search_tavily_2026-07-16", "route_search_tavily", 0.008),
  {
    id: "ps_browser_browserbase_2026-07-16",
    routeId: "route_browser_browserbase",
    currency: "USD",
    effectiveFrom: SEED_EFFECTIVE_FROM,
    effectiveTo: null,
    inputPerMillion: null,
    outputPerMillion: null,
    cachedInputPerMillion: null,
    perImage: null,
    perVideo: null,
    perThousandUtf8Bytes: null,
    perSearchRequest: null,
    perBrowserSecond: 0.002,
    perAudioSecond: null,
    source: "seed",
    notes: "Placeholder second rate; actual Browserbase session cost preferred when reported.",
  },

  // Shadow — classification / search / vision / media / TTS
  tokenSnap("ps_step35_flash_sf_2026-07-16", "route_classify_step35_flash_sf", 0.1, 0.3),
  searchSnap("ps_search_perplexity_2026-07-16", "route_search_perplexity", 0.005),
  searchSnap("ps_search_exa_2026-07-16", "route_search_exa", 0.007),
  tokenSnap("ps_vision_vl8b_sf_2026-07-16", "route_vision_qwen3_vl_8b_sf", 0.18, 0.68),
  tokenSnap("ps_vision_vl32b_sf_2026-07-16", "route_vision_qwen3_vl_32b_sf", 0.2, 1.5),
  imageSnap("ps_image_z_turbo_2026-07-16", "route_image_z_image_turbo", 0.005),
  imageSnap("ps_image_qwen_2026-07-16", "route_image_qwen_image", 0.02),
  imageSnap("ps_image_qwen_edit_2026-07-16", "route_image_qwen_image_edit", 0.04),
  imageSnap("ps_image_flux2_2026-07-16", "route_image_flux2_flex", 0.06),
  videoSnap("ps_video_wan22_t2v_2026-07-16", "route_video_wan22_t2v", 0.29),
  videoSnap("ps_video_wan22_i2v_2026-07-16", "route_video_wan22_i2v", 0.29),
  ttsSnap("ps_tts_cosyvoice2_2026-07-16", "route_tts_cosyvoice2", 0.00715),
  ttsSnap("ps_tts_indextts2_2026-07-16", "route_tts_indextts2", 0.00715),
  ttsSnap("ps_tts_fish_speech_2026-07-16", "route_tts_fish_speech", 0.015),
  ttsCharacterSnap("ps_call_tts_xai_2026-07-20", "route_call_tts_xai", 0.015),
  // STT — provisional per-second rates pending live reconciliation
  sttSnap("ps_stt_fast_2026-07-17", "route_stt_fast", 0.00006),
  sttSnap("ps_stt_accurate_2026-07-17", "route_stt_accurate", 0.00012),
  sttSnap("ps_stt_diarized_2026-07-17", "route_stt_diarized", 0.00015),
  sttSnap(
    "ps_call_stt_groq_turbo_2026-07-20",
    "route_call_stt_groq_turbo",
    0.04 / 3600,
  ),
  sttSnap(
    "ps_call_stt_groq_accurate_2026-07-20",
    "route_call_stt_groq_accurate",
    0.111 / 3600,
  ),

  // Evaluation
  tokenSnap("ps_eval_kimi_k27_2026-07-16", "route_eval_kimi_k27_code", 0.8592, 3.8, 0.1799),
  tokenSnap("ps_eval_qwen36_35b_2026-07-16", "route_eval_qwen36_35b", 0.2, 1.6),
  tokenSnap("ps_eval_qwen36_27b_2026-07-16", "route_eval_qwen36_27b", 0.3, 3.2),
  tokenSnap("ps_eval_glm52_v2_2026-07-16", "route_eval_glm52", 1.302, 4.092, 0.26),
  tokenSnap(
    "ps_eval_minimax_m3_v2_2026-07-16",
    "route_eval_minimax_m3",
    0.3,
    1.2,
    0.06,
    "Under-512K rates. Over-512K: 0.60/2.40/0.12 — new snapshot when needed.",
  ),
];

const MISSING_SNAPSHOT_ID = "ps_missing";
const LEGACY_SNAPSHOT_ID = "ps_legacy_unknown";

export function missingPricingSnapshotId(): string {
  return MISSING_SNAPSHOT_ID;
}

export function legacyPricingSnapshotId(): string {
  return LEGACY_SNAPSHOT_ID;
}

/** Live (effective_to null) snapshot for a route from the in-memory seed. */
export function getLiveSeedSnapshot(routeId: string): BrainPricingSnapshot | null {
  return (
    SEEDED_PRICING_SNAPSHOTS.find((s) => s.routeId === routeId && s.effectiveTo == null) ?? null
  );
}

export function getSeedSnapshotById(id: string): BrainPricingSnapshot | null {
  return SEEDED_PRICING_SNAPSHOTS.find((s) => s.id === id) ?? null;
}

/**
 * Compute USD from a snapshot + raw usage units.
 * Token formula: uncached×in + cached×cachedIn + output×out (per million).
 */
export function costUsdFromSnapshot(
  snapshot: BrainPricingSnapshot,
  usage: {
    inputTokens?: number;
    cachedInputTokens?: number;
    outputTokens?: number;
    imageCount?: number;
    videoCount?: number;
    ttsUtf8Bytes?: number;
    ttsCharacters?: number;
    searchRequests?: number;
    browserSessionSeconds?: number;
    audioSeconds?: number;
  },
): number {
  let usd = 0;
  const totalInput = Math.max(0, usage.inputTokens ?? 0);
  const cached = Math.min(Math.max(0, usage.cachedInputTokens ?? 0), totalInput);
  const uncached = Math.max(0, totalInput - cached);
  const output = Math.max(0, usage.outputTokens ?? 0);

  if (snapshot.inputPerMillion != null && (uncached > 0 || cached > 0 || output > 0)) {
    const cachedRate = snapshot.cachedInputPerMillion ?? snapshot.inputPerMillion;
    usd +=
      (uncached / 1_000_000) * snapshot.inputPerMillion +
      (cached / 1_000_000) * cachedRate +
      (output / 1_000_000) * (snapshot.outputPerMillion ?? 0);
  }

  if (snapshot.perImage != null && (usage.imageCount ?? 0) > 0) {
    usd += snapshot.perImage * (usage.imageCount ?? 0);
  }
  if (snapshot.perVideo != null && (usage.videoCount ?? 0) > 0) {
    usd += snapshot.perVideo * (usage.videoCount ?? 0);
  }
  if (snapshot.perThousandUtf8Bytes != null && (usage.ttsUtf8Bytes ?? 0) > 0) {
    usd += ((usage.ttsUtf8Bytes ?? 0) / 1000) * snapshot.perThousandUtf8Bytes;
  }
  if (snapshot.perThousandCharacters != null && (usage.ttsCharacters ?? 0) > 0) {
    usd += ((usage.ttsCharacters ?? 0) / 1000) * snapshot.perThousandCharacters;
  }
  if (snapshot.perSearchRequest != null && (usage.searchRequests ?? 0) > 0) {
    usd += snapshot.perSearchRequest * (usage.searchRequests ?? 0);
  }
  if (snapshot.perBrowserSecond != null && (usage.browserSessionSeconds ?? 0) > 0) {
    usd += snapshot.perBrowserSecond * (usage.browserSessionSeconds ?? 0);
  }
  if (snapshot.perAudioSecond != null && (usage.audioSeconds ?? 0) > 0) {
    usd += snapshot.perAudioSecond * (usage.audioSeconds ?? 0);
  }

  return usd;
}

/** Close old + open new id pattern for rate changes (immutability invariant). */
export function nextSnapshotId(routeId: string, effectiveFromIso: string): string {
  const day = effectiveFromIso.slice(0, 10);
  const short = routeId.replace(/^route_/, "").replace(/_/g, "");
  return `ps_${short}_${day}`;
}
