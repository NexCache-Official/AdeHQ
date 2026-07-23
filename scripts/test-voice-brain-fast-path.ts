import assert from "node:assert/strict";
import { routeVoiceBrainTurn } from "../src/lib/brain/voice/voice-brain-router";
import { resolveLocalInstantReply } from "../src/lib/brain/voice/local-instant-replies";
import {
  appendVoiceSessionTurn,
  compileVoiceFastPrompt,
  getVoiceSessionSnapshot,
  setVoiceSessionSnapshot,
  type VoiceSessionSnapshot,
} from "../src/lib/brain/voice/voice-session-snapshot";
import {
  createVoiceBrainLatencyTrace,
  markVoiceBrainLatency,
  voiceBrainLatencyDurations,
} from "../src/lib/brain/voice/voice-latency-trace";
import { prefetchFromInterimTranscript } from "../src/lib/brain/voice/voice-prefetch";

function sampleSnapshot(): VoiceSessionSnapshot {
  return {
    callId: "call_test",
    workspaceId: "ws",
    roomId: "room",
    topicId: "topic",
    humanUserId: "user",
    employeeId: "emp",
    employeeName: "Priya Carter",
    employeeRole: "Account Executive",
    employeePrompt: "You are Priya.",
    employeeVoiceProfile: {
      voiceEnabled: true,
      voiceIdentityKey: "employee-emp",
      locale: "en",
      pace: 1,
      tone: "warm",
      routePreference: "auto",
      genderMode: "auto",
      resolvedGender: "female",
      providerBindings: [],
      premiumVoiceAllowed: false,
    },
    conversationSummary: "Call just started.",
    recentTurns: [],
    activeEntities: [],
    relevantMemoryDigest: "",
    permissionsDigest: "Standard",
    availableToolNames: ["web_search"],
    promptCacheKey: "voice:emp:v1",
    version: 1,
    builtAt: Date.now(),
    lastUpdatedAt: Date.now(),
  };
}

assert.equal(
  routeVoiceBrainTurn({ message: "Hey Priya, how are you doing?" }).route,
  "local_instant",
);
assert.equal(
  routeVoiceBrainTurn({ message: "Thanks!" }).route,
  "local_instant",
);
assert.equal(
  routeVoiceBrainTurn({ message: "Are you there?" }).route,
  "local_instant",
);
assert.equal(
  routeVoiceBrainTurn({ message: "What do you think about retention vs acquisition?" })
    .route,
  "voice_fast",
);
assert.equal(
  routeVoiceBrainTurn({
    message: "Find the address for Dubai Shawarma in Canterbury",
  }).route,
  "work_full",
);

const greeting = resolveLocalInstantReply({
  decision: { route: "local_instant", reason: "greeting", localKind: "greeting" },
  employeeName: "Priya Carter",
  seed: "turn_1",
});
assert.ok(greeting && greeting.length > 8);
assert.ok(!/sure|certainly/i.test(greeting));

const snap = sampleSnapshot();
setVoiceSessionSnapshot(snap);
appendVoiceSessionTurn("call_test", {
  speaker: "human",
  text: "How should we price this?",
  at: new Date().toISOString(),
});
const stored = getVoiceSessionSnapshot("call_test");
assert.equal(stored?.recentTurns.length, 1);
const compiled = compileVoiceFastPrompt({
  snapshot: stored!,
  userMessage: "How should we price this?",
});
assert.ok(compiled.system.includes("Priya"));
assert.ok(compiled.prompt.includes("How should we price this?"));
assert.ok(!compiled.system.toLowerCase().includes("effects.toolcalls"));

const prefetch = prefetchFromInterimTranscript({
  callId: "call_test",
  partialText: "Can you research our competitors in",
});
assert.equal(prefetch?.predictedRoute, "work_full");

const trace = createVoiceBrainLatencyTrace({
  callId: "call_test",
  turnId: "turn_1",
  warm: true,
});
markVoiceBrainLatency(trace, "routingComplete", trace.turnReceivedAt + 15);
markVoiceBrainLatency(trace, "providerRequestStarted", trace.turnReceivedAt + 40);
markVoiceBrainLatency(trace, "providerFirstContentToken", trace.turnReceivedAt + 520);
markVoiceBrainLatency(trace, "firstTtsByte", trace.turnReceivedAt + 900);
const durations = voiceBrainLatencyDurations(trace);
assert.equal(durations.adehqPrepMs, 40);
assert.equal(durations.providerTtftMs, 480);
assert.equal(durations.firstAudioMs, 900);

console.log("Voice Brain Fast Path contracts: PASS");
