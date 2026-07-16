/**
 * PR-17 — Brain video generation unit tests (routing, policy, flags, estimate card).
 */
import assert from "node:assert/strict";
import { getBrainRoute } from "@/lib/brain/catalog/routes";
import { resolveRoutingPolicy } from "@/lib/brain/catalog/routing-policy";
import { isBrainVideoV1Enabled } from "@/lib/brain/flags";
import {
  VIDEO_ESTIMATE_CARD_SUMMARY,
  VIDEO_ESTIMATED_WH,
  estimatedWhForVideo,
  evaluateVideoGenerationPolicy,
  inferVideoIntent,
  memberLabelForVideoIntent,
  routeIdForVideoIntent,
} from "@/lib/brain/video";
import { getToolDefinition } from "@/lib/integrations/registry/tool-definitions";
import { costUsdFromSnapshot, getLiveSeedSnapshot } from "@/lib/brain/catalog";
import { workHoursFromCost } from "@/lib/billing/costing/work-hours";
import { chatFilePreviewKind } from "@/lib/chat/file-preview-kind";

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

run("catalog: video routes production at ~29 WH", () => {
  for (const id of ["route_video_wan22_t2v", "route_video_wan22_i2v"]) {
    const route = getBrainRoute(id);
    assert.equal(route?.environment, "production");
    assert.equal(route?.unitType, "video");
    const snap = getLiveSeedSnapshot(id);
    assert.ok(snap);
    const cost = costUsdFromSnapshot(snap!, { videoCount: 1 });
    assert.ok(Math.abs(cost - 0.29) < 1e-9);
    assert.ok(Math.abs(workHoursFromCost(cost) - 29) < 1e-9);
  }
  assert.equal(
    resolveRoutingPolicy("video_generation", "standard")?.primaryRouteId,
    "route_video_wan22_t2v",
  );
  assert.equal(
    resolveRoutingPolicy("video_generation", "deep")?.primaryRouteId,
    "route_video_wan22_i2v",
  );
});

run("intent maps to T2V/I2V without SKUs in labels", () => {
  assert.equal(routeIdForVideoIntent("text_to_video"), "route_video_wan22_t2v");
  assert.equal(routeIdForVideoIntent("image_to_video"), "route_video_wan22_i2v");
  assert.equal(memberLabelForVideoIntent("text_to_video"), "Create video from text");
  assert.equal(memberLabelForVideoIntent("image_to_video"), "Create video from image");
  assert.equal(estimatedWhForVideo(), VIDEO_ESTIMATED_WH);
  assert.equal(inferVideoIntent("create a video of a cat walking", false), "text_to_video");
  assert.equal(inferVideoIntent("animate this image into a clip", true), "image_to_video");
  assert.ok(!/Wan|SiliconFlow|A14B/i.test(memberLabelForVideoIntent("text_to_video")));
});

run("estimate card copy is exact and policy blocks insufficient WH", () => {
  assert.equal(
    VIDEO_ESTIMATE_CARD_SUMMARY,
    "Create one five-second video. Estimated usage: 29 Work Hours.",
  );
  assert.equal(
    evaluateVideoGenerationPolicy({
      intent: "text_to_video",
      remainingWh: 100,
      warningLevel: "ok",
      enabled: true,
    }).action,
    "proceed",
  );
  assert.equal(
    evaluateVideoGenerationPolicy({
      intent: "text_to_video",
      remainingWh: 28.9,
      warningLevel: "ok",
      enabled: true,
    }).action,
    "blocked_insufficient_wh",
  );
  assert.equal(
    evaluateVideoGenerationPolicy({
      intent: "image_to_video",
      remainingWh: 50,
      warningLevel: "exhausted",
      enabled: true,
    }).action,
    "blocked_exhausted",
  );
  assert.equal(
    evaluateVideoGenerationPolicy({
      intent: "text_to_video",
      remainingWh: 100,
      enabled: false,
    }).action,
    "blocked_disabled",
  );
  const decision = evaluateVideoGenerationPolicy({
    intent: "text_to_video",
    remainingWh: 10,
    enabled: true,
  });
  assert.equal(decision.estimateCard, VIDEO_ESTIMATE_CARD_SUMMARY);
  assert.ok(decision.reason?.includes("29"));
});

run("tool is approval-gated async video_create", () => {
  const tool = getToolDefinition("video.create");
  assert.ok(tool);
  assert.equal(tool?.approval, "required");
  assert.equal(tool?.asyncJobType, "video_create");
  const preview = tool!.buildPreview({
    intent: "text_to_video",
    prompt: "A calm ocean wave at golden hour",
  });
  assert.equal(preview.summary, VIDEO_ESTIMATE_CARD_SUMMARY);
});

run("chat preview treats mp4 as video", () => {
  assert.equal(chatFilePreviewKind({ extension: "mp4", toolName: "video.create" }), "video");
  assert.equal(chatFilePreviewKind({ mimeType: "video/mp4" }), "video");
});

run("kill switch disables Brain Video V1", () => {
  withEnv({ ADEHQ_BRAIN_VIDEO_V1: "0" }, () => {
    assert.equal(isBrainVideoV1Enabled(), false);
  });
  withEnv({ ADEHQ_BRAIN_VIDEO_V1: "1" }, () => {
    assert.equal(isBrainVideoV1Enabled(), true);
  });
});

console.log(`\n${passed} checks`);
console.log("PASS  test-brain-video");
