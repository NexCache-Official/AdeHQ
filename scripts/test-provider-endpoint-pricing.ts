/**
 * V20.1.1 — Provider endpoint pricing unit tests.
 */

import { buildEndpointKey } from "@/lib/ai/runtime/pricing/endpoint-key";
import { MANUAL_MODEL_OVERRIDES } from "@/lib/ai/runtime/pricing/manual-overrides";
import { offerToCatalogRow, rowToOffer } from "@/lib/ai/runtime/pricing/normalize";
import {
  aggregateSiliconFlowSkuRows,
  applySkuPricesToOffer,
} from "@/lib/ai/runtime/pricing/siliconflow-sku-parser";
import { buildVercelEndpointOverrides } from "@/lib/ai/runtime/pricing/vercel-endpoint-overrides";
import { withEndpointKey } from "@/lib/ai/runtime/pricing/endpoint-key";
import type { ModelEndpointOffer } from "@/lib/ai/runtime/pricing/types";

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
  await run("buildEndpointKey format", () => {
    assert(
      buildEndpointKey("vercel_gateway", "minimax/minimax-m2.5", "blackbox") ===
        "vercel_gateway:minimax/minimax-m2.5:blackbox",
      "blackbox key",
    );
    assert(
      buildEndpointKey("siliconflow_direct", "MiniMaxAI/MiniMax-M2.5") ===
        "siliconflow_direct:MiniMaxAI/MiniMax-M2.5:default",
      "SF default slug",
    );
  });

  await run("three Vercel MiniMax endpoints have distinct endpoint_key", () => {
    const endpoints = buildVercelEndpointOverrides().filter(
      (o) => o.modelId === "minimax/minimax-m2.5",
    );
    assert(endpoints.length === 3, `expected 3 MiniMax endpoints, got ${endpoints.length}`);
    const keys = new Set(endpoints.map((o) => o.endpointKey));
    assert(keys.size === 3, "endpoint keys must be unique");
    const slugs = endpoints.map((o) => o.gatewayProviderSlug).sort();
    assert(
      slugs.join(",") === "blackbox,deepinfra,minimax",
      `unexpected slugs: ${slugs.join(",")}`,
    );
  });

  await run("Vercel DeepSeek V4 Pro discount pricing + provenance", () => {
    const row = buildVercelEndpointOverrides().find(
      (o) => o.modelId === "deepseek/deepseek-v4-pro",
    );
    assert(row != null, "DeepSeek V4 Pro endpoint missing");
    assert(row!.inputCostPerMillion === 0.43, "input price");
    assert(row!.outputCostPerMillion === 0.87, "output price");
    assert(row!.originalInputCostPerMillion === 1.74, "original input");
    assert(row!.originalOutputCostPerMillion === 3.48, "original output");
    assert(row!.pricingDiscountActive === true, "discount flag");
    assert(row!.metadata?.verifiedBy === "manual_page_check", "provenance");
    assert(row!.metadata?.sourceUrl != null, "sourceUrl");
  });

  await run("SF DeepSeek V4 Pro corrected to 1.60/3.135", () => {
    const row = MANUAL_MODEL_OVERRIDES.find(
      (o) => o.modelId === "deepseek-ai/DeepSeek-V4-Pro",
    );
    assert(row != null, "SF DeepSeek V4 Pro override missing");
    assert(row!.inputCostPerMillion === 1.6, "input");
    assert(row!.outputCostPerMillion === 3.135, "output");
    assert(row!.cachedInputCostPerMillion === 0.135, "cache stored");
  });

  await run("SF MiniMax corrected to 0.30/1.20 cache 0.03", () => {
    const row = MANUAL_MODEL_OVERRIDES.find((o) => o.modelId === "MiniMaxAI/MiniMax-M2.5");
    assert(row != null, "SF MiniMax override missing");
    assert(row!.inputCostPerMillion === 0.3, "input");
    assert(row!.outputCostPerMillion === 1.2, "output");
    assert(row!.cachedInputCostPerMillion === 0.03, "cache");
  });

  await run("SiliconFlow SKU aggregation into one model row", () => {
    const aggregated = aggregateSiliconFlowSkuRows([
      { id: "minimaxai/minimax-m2.5.online.input-tokens", pricing: { input: 0.3 } },
      { id: "minimaxai/minimax-m2.5.online.output-tokens", pricing: { output: 1.2 } },
      { id: "minimaxai/minimax-m2.5.online.cached-input-tokens", pricing: { input: 0.03 } },
    ]);
    const parts = aggregated.get("MiniMaxAI/MiniMax-M2.5");
    assert(parts != null, "aggregated MiniMax");
    assert(parts!.inputCostPerMillion === 0.3, "SKU input");
    assert(parts!.outputCostPerMillion === 1.2, "SKU output");
    assert(parts!.cachedInputCostPerMillion === 0.03, "SKU cache");
  });

  await run("offerToCatalogRow / rowToOffer round-trip endpoint_key", () => {
    const offer = withEndpointKey({
      providerRoute: "vercel_gateway",
      providerName: "vercel",
      modelId: "minimax/minimax-m2.5",
      gatewayProviderSlug: "blackbox",
      normalizedModelFamily: "minimax-m2.5",
      displayName: "MiniMax M2.5 (Blackbox)",
      modelType: "language",
      capabilities: ["long_context"],
      runtimeModes: ["long_context"],
      inputCostPerMillion: 0.07,
      outputCostPerMillion: 0.57,
      contextWindow: 128_000,
      currency: "USD",
      supportsJson: false,
      supportsTools: false,
      supportsEmbeddings: false,
      supportsLongContext: true,
      enabled: true,
      source: "manual_override",
      metadata: {
        verifiedAt: "2026-07-06",
        verifiedBy: "manual_page_check",
        notes: "test",
      },
    } as ModelEndpointOffer);

    const row = offerToCatalogRow(offer, new Date().toISOString());
    assert(row.endpoint_key === offer.endpointKey, "endpoint_key in row");
    const roundTrip = rowToOffer(row as Record<string, unknown>);
    assert(roundTrip.endpointKey === offer.endpointKey, "endpoint_key round-trip");
    assert(roundTrip.gatewayProviderSlug === "blackbox", "gateway slug round-trip");
  });

  console.log("\nAll provider endpoint pricing tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
