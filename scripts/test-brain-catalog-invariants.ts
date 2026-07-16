/**
 * Brain PR-11 catalog invariants — every approved route has correct
 * model ID, unit type, provider, pricing, environment, and fallback relationship.
 * Usage: npx tsx scripts/test-brain-catalog-invariants.ts
 */
import {
  BRAIN_ROUTES,
  CATALOG_VERSION,
  SEEDED_PRICING_SNAPSHOTS,
  getBrainRoute,
  getFallbackChain,
  getLiveSeedSnapshot,
  nextSnapshotId,
} from "@/lib/brain/catalog";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function nearly(a: number | null | undefined, b: number, eps = 1e-9) {
  assert(a != null && Math.abs(a - b) <= eps, `expected ${b}, got ${a}`);
}

/** Approved catalog contract — production / fallback / shadow / evaluation / disabled. */
const APPROVED: Array<{
  id: string;
  model: string;
  environment: string;
  unitType: string;
  provider: string;
  /** Token rates or unit prices to assert when present. */
  rates?: {
    input?: number;
    output?: number;
    cached?: number;
    perImage?: number;
    perVideo?: number;
    perSearch?: number;
    perThousandUtf8?: number;
  };
  fallbackFor?: string;
  fallbacks?: string[];
  enabled?: boolean;
}> = [
  // Production
  {
    id: "route_text_v4flash_sf",
    model: "deepseek-ai/DeepSeek-V4-Flash",
    environment: "production",
    unitType: "tokens",
    provider: "siliconflow",
    rates: { input: 0.13, output: 0.28, cached: 0.028 },
    fallbacks: ["route_text_qwen3_8b_sf"],
  },
  {
    id: "route_text_v4pro_vg",
    model: "deepseek/deepseek-v4-pro",
    environment: "production",
    unitType: "tokens",
    provider: "vercel_gateway",
    rates: { input: 0.43, output: 0.87 },
    fallbacks: ["route_text_v4pro_sf_failover"],
  },
  {
    id: "route_text_v4pro_sf_failover",
    model: "deepseek-ai/DeepSeek-V4-Pro",
    environment: "fallback",
    unitType: "tokens",
    provider: "siliconflow",
    rates: { input: 1.5016, output: 3.135, cached: 0.135 },
    fallbackFor: "route_text_v4pro_vg",
  },
  {
    id: "route_text_minimax_m25_vg",
    model: "minimax/minimax-m2.5",
    environment: "production",
    unitType: "tokens",
    provider: "vercel_gateway",
    rates: { input: 0.27, output: 0.95 },
    fallbacks: ["route_text_minimax_m25_vg_native", "route_text_minimax_m25_sf"],
  },
  {
    id: "route_text_minimax_m25_vg_native",
    model: "minimax/minimax-m2.5",
    environment: "fallback",
    unitType: "tokens",
    provider: "vercel_gateway",
    rates: { input: 0.3, output: 1.2 },
    fallbackFor: "route_text_minimax_m25_vg",
  },
  {
    id: "route_text_minimax_m25_sf",
    model: "MiniMaxAI/MiniMax-M2.5",
    environment: "fallback",
    unitType: "tokens",
    provider: "siliconflow",
    rates: { input: 0.3, output: 1.2, cached: 0.03 },
    fallbackFor: "route_text_minimax_m25_vg",
  },
  {
    id: "route_text_qwen3_coder_sf",
    model: "Qwen/Qwen3-Coder-30B-A3B-Instruct",
    environment: "production",
    unitType: "tokens",
    provider: "siliconflow",
    rates: { input: 0.5, output: 1.0 },
  },
  {
    id: "route_text_qwen3_8b_sf",
    model: "Qwen/Qwen3-8B",
    environment: "production",
    unitType: "tokens",
    provider: "siliconflow",
    rates: { input: 0.06, output: 0.06 },
  },
  {
    id: "route_embed_qwen3_sf",
    model: "Qwen/Qwen3-Embedding-0.6B",
    environment: "production",
    unitType: "tokens",
    provider: "siliconflow",
    rates: { input: 0.02, output: 0.02 },
  },
  {
    id: "route_search_tavily",
    model: "tavily-search",
    environment: "production",
    unitType: "search",
    provider: "tavily",
    rates: { perSearch: 0.008 },
  },
  {
    id: "route_browser_browserbase",
    model: "browserbase-session",
    environment: "production",
    unitType: "browser_second",
    provider: "browserbase",
  },

  // Shadow candidates (not live)
  {
    id: "route_classify_step35_flash_sf",
    model: "stepfun-ai/Step-3.5-Flash",
    environment: "shadow",
    unitType: "tokens",
    provider: "siliconflow",
    rates: { input: 0.1, output: 0.3 },
  },
  {
    id: "route_search_perplexity",
    model: "perplexity-search",
    environment: "shadow",
    unitType: "search",
    provider: "perplexity",
    rates: { perSearch: 0.005 },
  },
  {
    id: "route_search_exa",
    model: "exa-search",
    environment: "shadow",
    unitType: "search",
    provider: "exa",
    rates: { perSearch: 0.007 },
  },
  {
    id: "route_vision_qwen3_vl_8b_sf",
    model: "Qwen/Qwen3-VL-8B-Instruct",
    environment: "shadow",
    unitType: "tokens",
    provider: "siliconflow",
    rates: { input: 0.18, output: 0.68 },
    fallbacks: ["route_vision_qwen3_vl_32b_sf"],
  },
  {
    id: "route_vision_qwen3_vl_32b_sf",
    model: "Qwen/Qwen3-VL-32B-Thinking",
    environment: "shadow",
    unitType: "tokens",
    provider: "siliconflow",
    rates: { input: 0.2, output: 1.5 },
    fallbackFor: "route_vision_qwen3_vl_8b_sf",
  },
  {
    id: "route_image_z_image_turbo",
    model: "Tongyi-MAI/Z-Image-Turbo",
    environment: "shadow",
    unitType: "image",
    provider: "siliconflow",
    rates: { perImage: 0.005 },
  },
  {
    id: "route_image_qwen_image",
    model: "Qwen/Qwen-Image",
    environment: "shadow",
    unitType: "image",
    provider: "siliconflow",
    rates: { perImage: 0.02 },
  },
  {
    id: "route_image_qwen_image_edit",
    model: "Qwen/Qwen-Image-Edit",
    environment: "shadow",
    unitType: "image",
    provider: "siliconflow",
    rates: { perImage: 0.04 },
  },
  {
    id: "route_image_flux2_flex",
    model: "black-forest-labs/FLUX.2-flex",
    environment: "shadow",
    unitType: "image",
    provider: "siliconflow",
    rates: { perImage: 0.06 },
  },
  {
    id: "route_video_wan22_t2v",
    model: "Wan-AI/Wan2.2-T2V-A14B",
    environment: "shadow",
    unitType: "video",
    provider: "siliconflow",
    rates: { perVideo: 0.29 },
  },
  {
    id: "route_video_wan22_i2v",
    model: "Wan-AI/Wan2.2-I2V-A14B",
    environment: "shadow",
    unitType: "video",
    provider: "siliconflow",
    rates: { perVideo: 0.29 },
  },
  {
    id: "route_tts_cosyvoice2",
    model: "FunAudioLLM/CosyVoice2-0.5B",
    environment: "shadow",
    unitType: "utf8_bytes",
    provider: "siliconflow",
    rates: { perThousandUtf8: 0.00715 },
  },
  {
    id: "route_tts_indextts2",
    model: "IndexTeam/IndexTTS-2",
    environment: "shadow",
    unitType: "utf8_bytes",
    provider: "siliconflow",
    rates: { perThousandUtf8: 0.00715 },
  },
  {
    id: "route_tts_fish_speech",
    model: "fishaudio/fish-speech-1.5",
    environment: "shadow",
    unitType: "utf8_bytes",
    provider: "siliconflow",
    rates: { perThousandUtf8: 0.015 },
  },

  // Evaluation
  {
    id: "route_eval_kimi_k27_code",
    model: "moonshotai/Kimi-K2.7-Code",
    environment: "evaluation",
    unitType: "tokens",
    provider: "siliconflow",
    rates: { input: 0.8592, output: 3.8, cached: 0.1799 },
    fallbackFor: "route_text_qwen3_coder_sf",
  },
  {
    id: "route_eval_qwen36_35b",
    model: "Qwen/Qwen3.6-35B-A3B",
    environment: "evaluation",
    unitType: "tokens",
    provider: "siliconflow",
    rates: { input: 0.2, output: 1.6 },
  },
  {
    id: "route_eval_qwen36_27b",
    model: "Qwen/Qwen3.6-27B",
    environment: "evaluation",
    unitType: "tokens",
    provider: "siliconflow",
    rates: { input: 0.3, output: 3.2 },
  },
  {
    id: "route_eval_glm52",
    model: "zai-org/GLM-5.2",
    environment: "evaluation",
    unitType: "tokens",
    provider: "siliconflow",
    rates: { input: 1.302, output: 4.092, cached: 0.26 },
  },
  {
    id: "route_eval_minimax_m3",
    model: "MiniMaxAI/MiniMax-M3",
    environment: "evaluation",
    unitType: "tokens",
    provider: "siliconflow",
    rates: { input: 0.3, output: 1.2, cached: 0.06 },
  },

  // Disabled STT reserved
  {
    id: "route_stt_fast",
    model: "stt.fast.unassigned",
    environment: "disabled",
    unitType: "audio_seconds",
    provider: "unassigned",
    enabled: false,
  },
  {
    id: "route_stt_accurate",
    model: "stt.accurate.unassigned",
    environment: "disabled",
    unitType: "audio_seconds",
    provider: "unassigned",
    enabled: false,
  },
  {
    id: "route_stt_diarized",
    model: "stt.diarized.unassigned",
    environment: "disabled",
    unitType: "audio_seconds",
    provider: "unassigned",
    enabled: false,
  },
];

function main() {
  assert(CATALOG_VERSION === "2", "CATALOG_VERSION must be 2 after PR-11 alignment");

  const ids = BRAIN_ROUTES.map((r) => r.id);
  assert(new Set(ids).size === ids.length, "route ids must be unique");

  for (const route of BRAIN_ROUTES) {
    const keys = Object.keys(route);
    assert(!keys.includes("inputPerMillion"), `${route.id} must be price-free`);
    assert(!keys.includes("perImage"), `${route.id} must be price-free`);
  }

  // No shadow/eval/disabled routes in production scoring set
  const livePrimaries = BRAIN_ROUTES.filter((r) => r.environment === "production");
  for (const route of livePrimaries) {
    assert(route.enabled, `production ${route.id} must be enabled`);
    const snap = getLiveSeedSnapshot(route.id);
    assert(snap, `production route ${route.id} needs a live snapshot`);
  }

  // Classification production remains Qwen3-8B (not Step yet)
  const classifier = getBrainRoute("route_text_qwen3_8b_sf");
  assert(classifier?.environment === "production", "Qwen3-8B stays production classifier");
  const step = getBrainRoute("route_classify_step35_flash_sf");
  assert(step?.environment === "shadow", "Step-3.5-Flash is shadow only");

  for (const expected of APPROVED) {
    const route = getBrainRoute(expected.id);
    assert(route, `missing route ${expected.id}`);
    assert(route.model === expected.model, `${expected.id} model: got ${route.model}`);
    assert(
      route.environment === expected.environment,
      `${expected.id} env: got ${route.environment}`,
    );
    assert(route.unitType === expected.unitType, `${expected.id} unitType`);
    assert(route.provider === expected.provider, `${expected.id} provider`);
    if (expected.enabled === false) {
      assert(!route.enabled, `${expected.id} must be disabled`);
      continue;
    }
    assert(route.enabled, `${expected.id} must be enabled`);

    const snap = getLiveSeedSnapshot(expected.id);
    assert(snap, `${expected.id} needs live pricing snapshot`);
    if (expected.rates?.input != null) nearly(snap.inputPerMillion, expected.rates.input);
    if (expected.rates?.output != null) nearly(snap.outputPerMillion, expected.rates.output);
    if (expected.rates?.cached != null) nearly(snap.cachedInputPerMillion, expected.rates.cached);
    if (expected.rates?.perImage != null) nearly(snap.perImage, expected.rates.perImage);
    if (expected.rates?.perVideo != null) nearly(snap.perVideo, expected.rates.perVideo);
    if (expected.rates?.perSearch != null) nearly(snap.perSearchRequest, expected.rates.perSearch);
    if (expected.rates?.perThousandUtf8 != null) {
      nearly(snap.perThousandUtf8Bytes, expected.rates.perThousandUtf8);
    }

    if (expected.fallbackFor) {
      assert(
        route.fallbackForRouteId === expected.fallbackFor,
        `${expected.id} fallbackFor mismatch`,
      );
    }
    if (expected.fallbacks) {
      assert(
        JSON.stringify(route.fallbackRouteIds ?? []) === JSON.stringify(expected.fallbacks),
        `${expected.id} fallbacks mismatch: ${JSON.stringify(route.fallbackRouteIds)}`,
      );
      const chain = getFallbackChain(expected.id);
      assert(chain.length === expected.fallbacks.length, `${expected.id} fallback chain length`);
    }
  }

  // Exactly one live seed snapshot per priced route id
  const liveByRoute = new Map<string, number>();
  for (const s of SEEDED_PRICING_SNAPSHOTS) {
    if (s.effectiveTo != null) continue;
    liveByRoute.set(s.routeId, (liveByRoute.get(s.routeId) ?? 0) + 1);
  }
  for (const [routeId, count] of liveByRoute) {
    assert(count === 1, `route ${routeId} has ${count} live snapshots`);
  }

  // Immutability
  const old = getLiveSeedSnapshot("route_text_v4flash_sf");
  assert(old, "flash snapshot");
  const newId = nextSnapshotId("route_text_v4flash_sf", "2026-08-01T00:00:00.000Z");
  assert(newId !== old.id, "rate change must allocate a new snapshot id");

  // Media / vision / voice must NOT be production
  for (const id of [
    "route_vision_qwen3_vl_8b_sf",
    "route_image_z_image_turbo",
    "route_video_wan22_t2v",
    "route_tts_cosyvoice2",
  ]) {
    const r = getBrainRoute(id);
    assert(r && r.environment !== "production", `${id} must not be production yet`);
  }

  console.log(`PASS  test-brain-catalog-invariants (${APPROVED.length} approved routes)`);
}

main();
