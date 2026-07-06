/**
 * V20.1.0a — Model pricing sync tests (offline-safe).
 */

import { MANUAL_MODEL_OVERRIDES } from "@/lib/ai/runtime/pricing/manual-overrides";
import { buildVercelEndpointOverrides } from "@/lib/ai/runtime/pricing/vercel-endpoint-overrides";
import { aggregateSiliconFlowSkuRows } from "@/lib/ai/runtime/pricing/siliconflow-sku-parser";
import { normalizeModelFamily } from "@/lib/ai/runtime/model-aliases";
import { syncModelPricing } from "@/lib/ai/runtime/pricing/sync";
import { syncSiliconFlowModels } from "@/lib/ai/runtime/pricing/siliconflow-sync";
import { syncVercelModels } from "@/lib/ai/runtime/pricing/vercel-sync";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

async function run(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

async function main() {
  await run("manual overrides include SiliconFlow + Vercel rows", () => {
    assert(MANUAL_MODEL_OVERRIDES.length >= 10, "expected at least 10 manual overrides");
    assert(
      MANUAL_MODEL_OVERRIDES.some((o) => o.providerRoute === "vercel_gateway"),
      "expected vercel overrides",
    );
  });

  await run("model family aliases normalize", () => {
    assert(
      normalizeModelFamily("deepseek-ai/DeepSeek-V4-Flash") === "deepseek-v4-flash",
      "deepseek flash family",
    );
    assert(normalizeModelFamily("openai/gpt-4o-mini") === "gpt-4o-mini", "gpt-4o-mini family");
  });

  await run("vercel sync skips without API key", async () => {
    const prev = process.env.AI_GATEWAY_API_KEY;
    delete process.env.AI_GATEWAY_API_KEY;
    const result = await syncVercelModels();
    process.env.AI_GATEWAY_API_KEY = prev;
    assert(result.status === "skipped", "expected skipped");
  });

  await run("siliconflow sync skips without API key", async () => {
    const prev = process.env.SILICONFLOW_API_KEY;
    delete process.env.SILICONFLOW_API_KEY;
    const result = await syncSiliconFlowModels();
    process.env.SILICONFLOW_API_KEY = prev;
    assert(result.status === "skipped", "expected skipped");
  });

  await run("dry-run orchestrator without DB client", async () => {
    const summary = await syncModelPricing(null, { dryRun: true });
    assert(summary.dryRun === true, "dry run flag");
    assert(summary.results.length === 2, "two providers");
  });

  await run("V20.1.1 — Vercel endpoint overrides coexist for MiniMax", () => {
    const endpoints = buildVercelEndpointOverrides().filter(
      (o) => o.modelId === "minimax/minimax-m2.5",
    );
    assert(endpoints.length === 3, "three MiniMax gateway endpoints");
    const keys = new Set(endpoints.map((o) => o.endpointKey));
    assert(keys.size === 3, "unique endpoint_key per provider slug");
  });

  await run("V20.1.1 — corrected SF + Vercel DeepSeek V4 Pro prices", () => {
    const sf = MANUAL_MODEL_OVERRIDES.find((o) => o.modelId === "deepseek-ai/DeepSeek-V4-Pro");
    assert(sf?.inputCostPerMillion === 1.6, "SF input");
    assert(sf?.outputCostPerMillion === 3.135, "SF output");

    const vg = buildVercelEndpointOverrides().find(
      (o) => o.modelId === "deepseek/deepseek-v4-pro",
    );
    assert(vg?.inputCostPerMillion === 0.43, "Vercel input");
    assert(vg?.outputCostPerMillion === 0.87, "Vercel output");
    assert(vg?.pricingDiscountActive === true, "discount active");
  });

  await run("V20.1.1 — SiliconFlow SKU parser aggregates billing rows", () => {
    const map = aggregateSiliconFlowSkuRows([
      { id: "deepseek-ai/deepseek-v4-pro.online.input-tokens", pricing: { input: 1.6 } },
      { id: "deepseek-ai/deepseek-v4-pro.online.output-tokens", pricing: { output: 3.135 } },
      { id: "deepseek-ai/deepseek-v4-pro.online.cached-input-tokens", pricing: { input: 0.135 } },
    ]);
    const parts = map.get("deepseek-ai/DeepSeek-V4-Pro");
    assert(parts?.inputCostPerMillion === 1.6, "aggregated input");
    assert(parts?.outputCostPerMillion === 3.135, "aggregated output");
    assert(parts?.cachedInputCostPerMillion === 0.135, "aggregated cache");
  });

  console.log("\nAll model pricing sync tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
