/**
 * PR-16 — Brain image creation/edit unit tests (routing, policy, flags, WH).
 */
import assert from "node:assert/strict";
import { getBrainRoute } from "@/lib/brain/catalog/routes";
import { resolveRoutingPolicy } from "@/lib/brain/catalog/routing-policy";
import { isBrainImageV1Enabled } from "@/lib/brain/flags";
import {
  estimatedWhForIntent,
  evaluateImageGenerationPolicy,
  formatImageTierOptions,
  inferImageIntent,
  memberLabelForIntent,
  routeIdForImageIntent,
} from "@/lib/brain/image";
import { getToolDefinition } from "@/lib/integrations/registry/tool-definitions";
import { costUsdFromSnapshot, getLiveSeedSnapshot } from "@/lib/brain/catalog";
import { workHoursFromCost } from "@/lib/billing/costing/work-hours";

function withEnv(patch: Record<string, string | undefined>, fn: () => void) {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(patch)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

let passed = 0;
function run(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS  ${name}`);
    passed += 1;
  } catch (error) {
    console.error(`FAIL  ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

run("catalog: image routes production with WH-aligned perImage rates", () => {
  const cases: Array<[string, number, number]> = [
    ["route_image_z_image_turbo", 0.005, 0.5],
    ["route_image_qwen_image", 0.02, 2],
    ["route_image_qwen_image_edit", 0.04, 4],
    ["route_image_flux2_flex", 0.06, 6],
  ];
  for (const [id, perImage, wh] of cases) {
    const route = getBrainRoute(id);
    assert.equal(route?.environment, "production");
    const snap = getLiveSeedSnapshot(id);
    assert.ok(snap);
    const cost = costUsdFromSnapshot(snap!, { imageCount: 1 });
    assert.ok(Math.abs(cost - perImage) < 1e-9);
    assert.ok(Math.abs(workHoursFromCost(cost) - wh) < 1e-9);
  }
  assert.equal(resolveRoutingPolicy("image_generation", "fast")?.primaryRouteId, "route_image_z_image_turbo");
  assert.equal(resolveRoutingPolicy("image_edit", "standard")?.primaryRouteId, "route_image_qwen_image_edit");
});

run("intent maps to routes and member labels without SKUs", () => {
  assert.equal(routeIdForImageIntent("quick"), "route_image_z_image_turbo");
  assert.equal(routeIdForImageIntent("business_graphic"), "route_image_qwen_image");
  assert.equal(routeIdForImageIntent("premium"), "route_image_flux2_flex");
  assert.equal(routeIdForImageIntent("edit"), "route_image_qwen_image_edit");
  assert.equal(memberLabelForIntent("quick"), "Create image");
  assert.equal(memberLabelForIntent("premium"), "Create premium visual");
  assert.equal(estimatedWhForIntent("business_graphic"), 2);
  assert.equal(inferImageIntent("make a business graphic with headline text"), "business_graphic");
  assert.equal(inferImageIntent("edit this image to remove the logo"), "edit");
  const tiers = formatImageTierOptions();
  assert.ok(!/Qwen|FLUX|Z-Image|SiliconFlow/i.test(tiers));
});

run("policy: standard proceeds; premium/edit need confirm; low balance asks", () => {
  assert.equal(
    evaluateImageGenerationPolicy({
      intent: "quick",
      remainingWh: 50,
      warningLevel: "ok",
    }).action,
    "proceed",
  );
  assert.equal(
    evaluateImageGenerationPolicy({
      intent: "premium",
      remainingWh: 50,
      warningLevel: "ok",
    }).action,
    "confirm_premium",
  );
  assert.equal(
    evaluateImageGenerationPolicy({
      intent: "premium",
      remainingWh: 50,
      warningLevel: "ok",
      confirmed: true,
    }).action,
    "proceed",
  );
  assert.equal(
    evaluateImageGenerationPolicy({
      intent: "quick",
      remainingWh: 1.2,
      warningLevel: "low",
    }).action,
    "confirm_low_balance",
  );
  assert.equal(
    evaluateImageGenerationPolicy({
      intent: "business_graphic",
      remainingWh: 1,
      warningLevel: "ok",
    }).action,
    "blocked",
  );
});

run("tools registered for create/edit/regenerate", () => {
  assert.ok(getToolDefinition("image.create"));
  assert.ok(getToolDefinition("image.edit"));
  assert.ok(getToolDefinition("image.regenerate"));
  assert.equal(getToolDefinition("image.create")?.asyncJobType, "image_create");
});

run("kill switch disables Brain Image V1", () => {
  withEnv({ ADEHQ_BRAIN_IMAGE_V1: "0" }, () => {
    assert.equal(isBrainImageV1Enabled(), false);
  });
  withEnv({ ADEHQ_BRAIN_IMAGE_V1: "1" }, () => {
    assert.equal(isBrainImageV1Enabled(), true);
  });
});

console.log(`\n${passed} checks`);
console.log("PASS  test-brain-image");
