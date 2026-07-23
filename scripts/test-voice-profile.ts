import assert from "node:assert/strict";
import {
  bridgeClipKey,
  cacheBridgeClip,
  createProgressiveFillerScheduler,
  getCachedBridgeClip,
  HybridLocalTurnDetector,
  inferVoiceGenderFromName,
  isLikelySttHallucination,
  normalizeEmployeeVoiceProfile,
  resolveProviderVoice,
  transcriptHasUsableSpeech,
  voiceMatchesGender,
  XAI_FEMALE_VOICES,
  XAI_MALE_VOICES,
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

assert.equal(inferVoiceGenderFromName("Priya Carter"), "female");
assert.equal(inferVoiceGenderFromName("David Chen"), "male");
const priya = normalizeEmployeeVoiceProfile(
  "emp-priya",
  { genderMode: "auto" },
  { employeeName: "Priya Carter", realignGender: true },
);
assert.equal(priya.resolvedGender, "female");
assert.ok(
  voiceMatchesGender(
    resolveProviderVoice(priya, "xai", "standard") ?? "",
    "female",
    "xai",
  ),
);
assert.ok((XAI_FEMALE_VOICES as readonly string[]).includes(resolveProviderVoice(priya, "xai", "standard")!));
const david = normalizeEmployeeVoiceProfile(
  "emp-david",
  { genderMode: "auto" },
  { employeeName: "David Chen", realignGender: true },
);
assert.equal(david.resolvedGender, "male");
assert.ok((XAI_MALE_VOICES as readonly string[]).includes(resolveProviderVoice(david, "xai", "standard")!));

const spoken: string[] = [];
const scheduler = createProgressiveFillerScheduler({
  seed: "turn_fill",
  intervalMs: 10_000,
  maxPhrases: 2,
  speak: (phrase) => spoken.push(phrase),
});
scheduler.start("thinking");
assert.equal(spoken.length, 1);
scheduler.stop();
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
    ).commit,
    false,
    "500ms silence must not endpoint with the longer pause policy",
  );
  assert.equal(
    (
      await detector.evaluate({
        speechDurationMs: 800,
        silenceDurationMs: 1200,
        semanticCompletionConfidence: 0.8,
      })
    ).reason,
    "semantic_complete",
  );
  assert.equal(
    (
      await detector.evaluate({
        speechDurationMs: 800,
        silenceDurationMs: 1900,
        semanticCompletionConfidence: 0,
      })
    ).reason,
    "hard_timeout",
  );

  assert.equal(
    isLikelySttHallucination({
      text: "Thank you.",
      confidence: 0.4,
      durationSeconds: 0.5,
    }),
    true,
  );
  assert.equal(
    isLikelySttHallucination({
      text: "Thanks for watching!",
      durationSeconds: 1.2,
    }),
    true,
  );
  assert.equal(
    transcriptHasUsableSpeech({
      text: "Can you update the Dubai Shawarma deal?",
      confidence: 0.8,
      durationSeconds: 2.4,
    }),
    true,
  );
  assert.equal(
    transcriptHasUsableSpeech({
      text: "yes",
      confidence: 0.9,
      durationSeconds: 0.6,
    }),
    true,
  );

  console.log("Voice profile and local turn detector contracts: PASS");
}

void main();
