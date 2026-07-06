/**
 * V20.1.0c — Optional capability verification (live keys required).
 * SKIPs when provider keys are missing.
 */

import { staticCatalogOffers } from "@/lib/ai/runtime/catalog/loader";
import { isSiliconFlowConfigured } from "@/lib/config/features";
import { isVercelGatewayConfigured } from "@/lib/ai/runtime/adapters/vercel-models";

function skip(reason: string) {
  console.log(`SKIPPED: ${reason}`);
  process.exit(0);
}

async function main() {
  if (!isSiliconFlowConfigured() && !isVercelGatewayConfigured()) {
    skip("No SILICONFLOW_API_KEY or AI_GATEWAY_API_KEY — capability smoke requires live keys.");
  }

  const offers = staticCatalogOffers().filter((o) => o.enabled && o.providerRoute !== "mock");
  console.log(`Capability verification scaffold: ${offers.length} offers in static catalog.`);
  console.log("Live smoke calls are optional — run with provider keys in CI/staging only.");
  console.log("Verified_at columns are updated by admin sync + future automated probes.");

  console.log("\nCapability verification scaffold OK.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
