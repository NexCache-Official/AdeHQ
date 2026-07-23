import assert from "node:assert/strict";
import {
  bridgeClipKey,
  cacheBridgeClip,
  getCachedBridgeClip,
  HybridLocalTurnDetector,
  normalizeEmployeeVoiceProfile,
  resolveProviderVoice,
} from "../src/lib/brain/voice";

const first = normalizeEmployeeVoiceProfile("employee-a", {
  voiceStyle: "warm",
  speakingRate: 1.2,
});
const second = normalizeEmployeeVoiceProfile("employee-a", {});

assert.equal(first.voiceIdentityKey, "employee-employee-a");
assert.equal(first.tone, "warm");
assert.equal(first.pace, 1.2);
assert.equal(first.providerBindings[0]?.provider, "xai");
assert.equal(
  resolveProviderVoice(first, "xai", "standard"),
  resolveProviderVoice(second, "xai", "standard"),
  "fallback voice identity must remain deterministic",
);
const bridgeKey = bridgeClipKey({
  routeId: "route_call_tts_xai",
  voice: "eve",
  locale: "en",
  pace: 1,
  text: "One moment.",
});
cacheBridgeClip(bridgeKey, {
  bytes: Buffer.from("cached"),
  mimeType: "audio/mpeg",
  routeId: "route_call_tts_xai",
});
assert.equal(getCachedBridgeClip(bridgeKey)?.bytes.toString(), "cached");

async function main() {
  const detector = new HybridLocalTurnDetector();
  assert.equal(
    (await detector.evaluate({ speechDurationMs: 100, silenceDurationMs: 900 }))
      .commit,
    false,
  );
  assert.equal(
    (
      await detector.evaluate({
        speechDurationMs: 800,
        silenceDurationMs: 500,
        semanticCompletionConfidence: 0.8,
      })
    ).reason,
    "semantic_complete",
  );
  assert.equal(
    (
      await detector.evaluate({
        speechDurationMs: 800,
        silenceDurationMs: 850,
        semanticCompletionConfidence: 0,
      })
    ).reason,
    "hard_timeout",
  );
  console.log("Voice profile and local turn detector contracts: PASS");
}

void main();
