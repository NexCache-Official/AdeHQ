/**
 * PR-15 — Brain vision unit tests (routing, confidence, normalize, flags).
 */
import assert from "node:assert/strict";
import { getBrainRoute } from "@/lib/brain/catalog/routes";
import { resolveRoutingPolicy } from "@/lib/brain/catalog/routing-policy";
import { isBrainVisionV1Enabled } from "@/lib/brain/flags";
import {
  assessVisionConfidence,
  guessVisualKind,
  inferVisionNeed,
  isVisionEligibleFile,
  shouldEscalateFromStandard,
  shouldRunVision,
  shouldStartOnEscalationRoute,
  VISION_ESCALATE_CONFIDENCE_BELOW,
} from "@/lib/brain/vision";
import { validateUploadType } from "@/lib/server/file-processing";

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

run("catalog: VL-8B production primary with VL-32B fallback", () => {
  const eight = getBrainRoute("route_vision_qwen3_vl_8b_sf");
  const thirty = getBrainRoute("route_vision_qwen3_vl_32b_sf");
  assert.equal(eight?.environment, "production");
  assert.equal(thirty?.environment, "production");
  assert.equal(eight?.model, "Qwen/Qwen3-VL-8B-Instruct");
  assert.equal(thirty?.model, "Qwen/Qwen3-VL-32B-Thinking");
  assert.deepEqual(eight?.fallbackRouteIds, ["route_vision_qwen3_vl_32b_sf"]);
  const policy = resolveRoutingPolicy("vision", "standard");
  assert.equal(policy?.primaryRouteId, "route_vision_qwen3_vl_8b_sf");
  const deep = resolveRoutingPolicy("vision", "deep");
  assert.equal(deep?.primaryRouteId, "route_vision_qwen3_vl_32b_sf");
});

run("standard need starts on VL-8B; complex starts on VL-32B", () => {
  assert.equal(inferVisionNeed({ userMessage: "What is in this screenshot?", assetCount: 1 }), "standard");
  assert.equal(
    inferVisionNeed({ userMessage: "Debug the root cause of this UI bug", assetCount: 1 }),
    "complex",
  );
  assert.equal(shouldStartOnEscalationRoute("standard"), false);
  assert.equal(shouldStartOnEscalationRoute("complex"), true);
});

run("escalate only when VL-8B confidence is insufficient", () => {
  const high = assessVisionConfidence({
    rawText: JSON.stringify({
      understanding: "A blue button labeled Save",
      confidence: 0.91,
      uncertainDetails: [],
      needsEscalation: false,
    }),
    userMessage: "What does the button say?",
    need: "standard",
  });
  assert.equal(shouldEscalateFromStandard(high), false);

  const low = assessVisionConfidence({
    rawText: JSON.stringify({
      understanding: "Possibly a chart",
      confidence: VISION_ESCALATE_CONFIDENCE_BELOW - 0.1,
      uncertainDetails: ["axis labels", "legend", "title"],
      needsEscalation: true,
    }),
    userMessage: "Read the chart",
    need: "standard",
  });
  assert.equal(shouldEscalateFromStandard(low), true);
});

run("image uploads are accepted; vision-eligible detection", () => {
  const png = validateUploadType("shot.png", "image/png");
  assert.equal(png.ok, true);
  assert.equal(isVisionEligibleFile({ mimeType: "image/jpeg", extension: "jpg" }), true);
  assert.equal(isVisionEligibleFile({ mimeType: "application/pdf", extension: "pdf", parseStatus: "no_text" }), true);
  assert.equal(isVisionEligibleFile({ mimeType: "text/plain", extension: "txt" }), false);
  assert.equal(guessVisualKind("ui-bug-checkout.png", "find the layout bug"), "ui_bug");
});

run("kill switch disables Brain Vision V1", () => {
  withEnv({ ADEHQ_BRAIN_VISION_V1: "0" }, () => {
    assert.equal(isBrainVisionV1Enabled(), false);
    assert.equal(
      shouldRunVision({
        attachmentFileIds: ["f1"],
        hasVisualAssets: true,
        userMessage: "look at this image",
      }),
      false,
    );
  });
  withEnv({ ADEHQ_BRAIN_VISION_V1: "1" }, () => {
    assert.equal(isBrainVisionV1Enabled(), true);
    assert.equal(
      shouldRunVision({
        attachmentFileIds: ["f1"],
        hasVisualAssets: true,
        userMessage: "look at this image",
      }),
      true,
    );
  });
});

console.log(`\n${passed} checks`);
console.log("PASS  test-brain-vision");
