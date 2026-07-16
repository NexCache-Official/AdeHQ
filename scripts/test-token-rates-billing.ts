/**
 * Billing token-rate resolution — Vercel Gateway DeepSeek V4 Pro + SiliconFlow peers.
 * Usage: npx tsx scripts/test-token-rates-billing.ts
 */
import { estimateCost } from "@/lib/ai/model-catalog";
import { calculateModelCost } from "@/lib/billing/costing/calculate-model-cost";
import { workHoursFromCost } from "@/lib/billing/costing/work-hours";
import { resolveTokenRates } from "@/lib/billing/costing/token-rates";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function nearly(a: number, b: number, eps = 1e-9) {
  assert(Math.abs(a - b) <= eps, `expected ${b}, got ${a}`);
}

async function main() {
  const vgPro = resolveTokenRates("deepseek/deepseek-v4-pro", {
    providerRoute: "vercel_gateway",
  });
  nearly(vgPro.inputPerMillion, 0.43);
  nearly(vgPro.outputPerMillion, 0.87);
  assert(vgPro.source === "endpoint_override", "gateway pro from overrides");

  const sfPro = resolveTokenRates("deepseek-ai/DeepSeek-V4-Pro", {
    providerRoute: "siliconflow_direct",
  });
  nearly(sfPro.inputPerMillion, 1.5016);
  nearly(sfPro.outputPerMillion, 3.135);

  const sfFlash = resolveTokenRates("deepseek-ai/DeepSeek-V4-Flash");
  nearly(sfFlash.inputPerMillion, 0.13);
  nearly(sfFlash.outputPerMillion, 0.28);

  const qwen = resolveTokenRates("Qwen/Qwen3-8B");
  nearly(qwen.inputPerMillion, 0.06);
  nearly(qwen.outputPerMillion, 0.06);

  // 1M in + 1M out on gateway Pro → $0.43 + $0.87 = $1.30 → 130 work hours @ $0.01/h
  const proCost = estimateCost("deepseek/deepseek-v4-pro", 1_000_000, 1_000_000, {
    providerRoute: "vercel_gateway",
  });
  nearly(proCost, 1.3);
  nearly(workHoursFromCost(proCost), 130);

  // Cached subset must not be double-billed at full input rate
  const withCache = calculateModelCost({
    modelId: "deepseek-ai/DeepSeek-V4-Flash",
    inputTokens: 1_000_000,
    cachedInputTokens: 500_000,
    outputTokens: 0,
    providerRoute: "siliconflow_direct",
  });
  // 500k uncached @ 0.13 + 500k cached @ 0.028 = 0.065 + 0.014 = 0.079
  nearly(withCache.costUsd, 0.079);
  assert(withCache.costSource === "token_rates", "token counts × rates → token_rates");

  console.log("PASS  test-token-rates-billing");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
