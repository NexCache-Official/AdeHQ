/**
 * intensity ≠ model invariant — chips must not map directly to model ids.
 * Usage: npx tsx scripts/test-brain-intensity-invariant.ts
 */
import { mapWorkModeToIntensity } from "@/lib/brain/packet/cognitive-packet";
import { routeCapabilityV2 } from "@/lib/brain/router";
import { resolveRoutingPolicy } from "@/lib/brain/catalog";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function main() {
  assert(mapWorkModeToIntensity("balanced") === "standard", "balanced → standard");
  assert(mapWorkModeToIntensity("standard") === "standard", "standard stays");
  assert(mapWorkModeToIntensity("fast") === "fast", "fast");

  const fast = routeCapabilityV2({
    capability: "reasoning",
    intensity: "fast",
    message: "hi",
  });
  const deep = routeCapabilityV2({
    capability: "deep_reasoning",
    intensity: "deep",
    message: "hard problem",
  });

  // Intensity affects USD range / policy, not a hardcoded model string in the chip layer.
  assert(fast.estimatedLikelyCostUsd < deep.estimatedLikelyCostUsd, "deep costs more than fast");

  const policy = resolveRoutingPolicy("deep_reasoning", "deep");
  assert(policy?.primaryRouteId === "route_text_v4pro_vg", "policy picks route, not chip");
  assert(!policy?.primaryRouteId.includes("fast"), "intensity chip is not a model id");

  console.log("PASS  test-brain-intensity-invariant");
}

main();
