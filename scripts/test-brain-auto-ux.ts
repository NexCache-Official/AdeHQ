/**
 * PR-12 — Auto intelligence UX + hire policy + intensity → modelMode wiring.
 */

import assert from "node:assert/strict";
import {
  buildIntelligencePolicyForHire,
  formatEmployeeIntelligenceSummary,
  preferredIntensityFloorFromMode,
} from "@/lib/ai/intelligence-policy";
import { CANDIDATE_ARCHETYPES } from "@/lib/hiring/candidate-archetypes";
import {
  applyIntensityFloor,
  modelModeFromIntensity,
  resolveBrainAwareModelMode,
  resolveEffectiveIntensity,
} from "@/lib/brain/resolve-auto-run";

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

run("hire policy is Auto with intensity floor from former tier", () => {
  const cheap = buildIntelligencePolicyForHire({ modelMode: "cheap", roleKey: "marketing" });
  assert.equal(cheap.defaultMode, "auto");
  assert.deepEqual(cheap.allowedModes, ["auto"]);
  assert.equal(cheap.preferredIntensityFloor, "fast");

  const strong = buildIntelligencePolicyForHire({ modelMode: "strong", roleKey: "pm" });
  assert.equal(strong.defaultMode, "auto");
  assert.equal(strong.preferredIntensityFloor, "deep");

  const balanced = buildIntelligencePolicyForHire({ modelMode: "balanced", roleKey: "sales" });
  assert.equal(balanced.defaultMode, "auto");
  assert.equal(balanced.preferredIntensityFloor, "standard");
});

run("hire archetypes show Auto, not Efficient/Balanced/Strong", () => {
  for (const tier of Object.keys(CANDIDATE_ARCHETYPES) as Array<keyof typeof CANDIDATE_ARCHETYPES>) {
    const a = CANDIDATE_ARCHETYPES[tier];
    assert.equal(a.defaultIntelligence, "Auto");
    assert.doesNotMatch(a.defaultIntelligence, /Efficient|Balanced|Strong/);
    assert.equal(a.commonModels, "");
  }
});

run("summary labels Auto for Auto employees", () => {
  const summary = formatEmployeeIntelligenceSummary({
    roleKey: "marketing",
    modelMode: "strong",
    intelligencePolicy: buildIntelligencePolicyForHire({ modelMode: "strong" }),
  });
  assert.equal(summary, "Auto intelligence");
});

run("intensity floor raises fast → deep when Strong bias present", () => {
  assert.equal(applyIntensityFloor("fast", "deep"), "deep");
  assert.equal(applyIntensityFloor("research", "deep"), "research");
  assert.equal(preferredIntensityFloorFromMode("strong"), "deep");
  assert.equal(resolveEffectiveIntensity({ workMode: "fast", preferredIntensityFloor: "deep" }), "deep");
});

run("Brain Auto maps intensity + heuristic without employee modelMode pin", () => {
  withEnv({ ADEHQ_BRAIN_V1: "1" }, () => {
    const employee = {
      roleKey: "marketing" as const,
      modelMode: "cheap" as const,
      intelligencePolicy: buildIntelligencePolicyForHire({ modelMode: "cheap" }),
    };
    const resolved = resolveBrainAwareModelMode({
      employee,
      heuristicModelMode: "balanced",
      workMode: "deep",
    });
    assert.equal(resolved.auto, true);
    assert.equal(resolved.intensity, "deep"); // floor fast + chip deep → deep
    assert.equal(resolved.modelMode, "strong");
    assert.equal(modelModeFromIntensity("fast"), "cheap");
  });
});

run("kill switch disables Auto remapping", () => {
  withEnv({ ADEHQ_BRAIN_V1: "0" }, () => {
    const employee = {
      roleKey: "marketing" as const,
      modelMode: "cheap" as const,
      intelligencePolicy: buildIntelligencePolicyForHire({ modelMode: "cheap" }),
    };
    const resolved = resolveBrainAwareModelMode({
      employee,
      heuristicModelMode: "balanced",
      workMode: "deep",
    });
    assert.equal(resolved.auto, false);
    assert.equal(resolved.modelMode, "balanced");
  });
});

console.log(`\n${passed} checks`);
if (process.exitCode) process.exit(process.exitCode);
console.log("PASS  test-brain-auto-ux");
