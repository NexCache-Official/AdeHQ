/**
 * V20.1.0a — Model pricing sync tests (offline-safe).
 */

import { MANUAL_MODEL_OVERRIDES } from "@/lib/ai/runtime/pricing/manual-overrides";
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

  console.log("\nAll model pricing sync tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
