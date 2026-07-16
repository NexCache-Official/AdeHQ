/**
 * Brain PR-2 Part 11 test matrix (offline — no DB).
 * Usage: npx tsx scripts/test-brain-metering-matrix.ts
 */
import {
  costUsdFromSnapshot,
  getLiveSeedSnapshot,
  nextSnapshotId,
} from "@/lib/brain/catalog";
import { computeUsageCost } from "@/lib/brain/metering/compute-usage-cost";
import { displayWorkHours, workHoursFromCost } from "@/lib/billing/costing/work-hours";
import { calculateModelCost } from "@/lib/billing/costing/calculate-model-cost";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function nearly(a: number, b: number, eps = 1e-9) {
  assert(Math.abs(a - b) <= eps, `expected ${b}, got ${a}`);
}

function main() {
  // Cached-subset math — V4 Flash SF
  const flash = getLiveSeedSnapshot("route_text_v4flash_sf");
  assert(flash, "flash snapshot");
  const cachedUsd = costUsdFromSnapshot(flash, {
    inputTokens: 1_000_000,
    cachedInputTokens: 200_000,
    outputTokens: 50_000,
  });
  nearly(cachedUsd, 0.1236);
  nearly(workHoursFromCost(cachedUsd), 12.36);
  nearly(displayWorkHours(12.36), 12.36);

  // Deep reasoning — V4 Pro Gateway
  const pro = getLiveSeedSnapshot("route_text_v4pro_vg");
  assert(pro, "pro snapshot");
  const proUsd = costUsdFromSnapshot(pro, {
    inputTokens: 120_000,
    outputTokens: 8_000,
  });
  nearly(proUsd, 0.05856);
  nearly(workHoursFromCost(proUsd), 5.856);
  nearly(displayWorkHours(5.856), 5.85);

  // Small real reply — no floor
  const small = computeUsageCost({
    routeId: "route_text_v4flash_sf",
    usage: { inputTokens: 900, outputTokens: 250 },
  });
  nearly(small.costUsd, 0.000187);
  nearly(workHoursFromCost(small.costUsd), 0.0187);
  nearly(displayWorkHours(0.0187), 0.01);
  assert(small.costSource === "token_rates", "small reply costSource token_rates");

  // Tiny reply — floor must NOT fire (defect C)
  const tiny = computeUsageCost({
    routeId: "route_text_v4flash_sf",
    usage: { inputTokens: 100, outputTokens: 20 },
  });
  nearly(tiny.costUsd, 0.0000186);
  nearly(workHoursFromCost(tiny.costUsd), 0.0019);
  nearly(displayWorkHours(0.0019), 0);
  assert(tiny.costSource === "token_rates", "tiny reply not estimated");

  // Empty telemetry — floor fires
  const empty = computeUsageCost({
    routeId: "route_text_v4flash_sf",
    usage: {},
    providerCalled: true,
  });
  nearly(empty.costUsd, 0.0001);
  nearly(workHoursFromCost(empty.costUsd), 0.01);
  assert(empty.costSource === "estimated", "empty telemetry estimated");

  // Flat image
  const image = computeUsageCost({
    routeId: "route_image_qwen_image",
    usage: { imageCount: 3 },
  });
  nearly(image.costUsd, 0.06);
  nearly(workHoursFromCost(image.costUsd), 6);

  // TTS
  const tts = computeUsageCost({
    routeId: "route_tts_cosyvoice2",
    usage: { ttsUtf8Bytes: 2750 },
  });
  nearly(tts.costUsd, 0.0196625);
  nearly(workHoursFromCost(tts.costUsd), 1.9663);
  nearly(displayWorkHours(1.9663), 1.96);

  // costSource labeling (defect B) via calculateModelCost
  const labeled = calculateModelCost({
    modelId: "deepseek-ai/DeepSeek-V4-Flash",
    inputTokens: 1000,
    outputTokens: 100,
    providerRoute: "siliconflow_direct",
  });
  assert(labeled.costSource === "token_rates", "calculateModelCost → token_rates");

  // Snapshot immutability
  const newId = nextSnapshotId("route_text_v4flash_sf", "2026-09-01T00:00:00.000Z");
  assert(newId !== flash.id, "rate change new snapshot id");

  // Property: WH == round4(usd / 0.01)
  for (const usd of [0.0000186, 0.1236, 0.06, 1.3]) {
    const wh = workHoursFromCost(usd);
    nearly(wh, Math.round((usd / 0.01) * 10000) / 10000);
  }

  console.log("PASS  test-brain-metering-matrix");
}

main();
