import assert from "node:assert/strict";
import {
  GROQ_MINIMUM_BILLABLE_SECONDS,
  LIVE_STT_MEDIA_BOUNDARY,
  SpeechChunker,
  pcm16ToWav,
  resolveStreamingSttRoutes,
  sanitizeTextForSpeech,
  selectSpeechRoutes,
} from "../src/lib/brain/voice";

const proEntitlements = {
  enabled: true,
  maxConcurrentCallsPerWorkspace: 1,
  maxConcurrentCallsPerHuman: 1,
  maxCallDurationMinutes: 30,
  maxIdleMinutes: 5,
  maxTurnWh: 5,
  premiumVoiceEnabled: false,
  recordingEnabled: true,
  transcriptRetentionDays: 90,
};

const threeSecondBillable = Math.max(3, GROQ_MINIMUM_BILLABLE_SECONDS);
const threeSecondCost = (threeSecondBillable / 3600) * 0.04;
const threeSecondWh = threeSecondCost / 0.01;
assert.equal(threeSecondBillable, 10);
assert.ok(Math.abs(threeSecondWh - 0.0111111111) < 0.000001);

const sixtyOneSecondRequestsWh =
  ((60 * GROQ_MINIMUM_BILLABLE_SECONDS) / 3600) * 0.04 / 0.01;
assert.ok(Math.abs(sixtyOneSecondRequestsWh - 0.6666666667) < 0.000001);

const routes = selectSpeechRoutes({
  callMode: "fast_turn",
  entitlements: proEntitlements,
});
assert.equal(routes.stt.mode, "batch_utterance");
assert.equal(routes.tts.mode, "streaming_audio");
const streamingRoutes = selectSpeechRoutes({
  callMode: "live_streaming",
  truePartialsRequired: true,
  entitlements: proEntitlements,
});
assert.equal(streamingRoutes.stt.mode, "streaming");
assert.equal(streamingRoutes.sttMemberLabel, "Live captions");
assert.equal(LIVE_STT_MEDIA_BOUNDARY.preRollMs, 200);
assert.equal(LIVE_STT_MEDIA_BOUNDARY.maximumTrailingSilenceMs, 800);
assert.deepEqual(
  resolveStreamingSttRoutes({
    ADEHQ_LIVE_STT_PROVIDER: "xai",
    ADEHQ_LIVE_STT_SHADOW_PROVIDERS: "deepgram,moonshine,xai",
  } as NodeJS.ProcessEnv),
  [
    {
      provider: "xai",
      role: "active",
      transport: "managed_websocket",
      emitsPartials: true,
      localTurnCommit: true,
    },
    {
      provider: "deepgram",
      role: "shadow",
      transport: "managed_websocket",
      emitsPartials: true,
      localTurnCommit: true,
    },
    {
      provider: "moonshine",
      role: "shadow",
      transport: "worker_websocket",
      emitsPartials: true,
      localTurnCommit: true,
    },
  ],
);
assert.throws(
  () =>
    resolveStreamingSttRoutes({
      ADEHQ_LIVE_STT_PROVIDER: "deepgram",
    } as NodeJS.ProcessEnv),
  /shadow-route contract only/,
);

const chunker = new SpeechChunker();
assert.deepEqual(chunker.push("I found three major competitors."), [
  "I found three major competitors.",
]);
const chunks = chunker.push(
  " The strongest is Acme because it converts mobile traffic more effectively.",
);
assert.deepEqual(chunks, [
  "The strongest is Acme because it converts mobile traffic more effectively.",
]);
assert.deepEqual(chunker.finish(), []);

const timeoutChunker = new SpeechChunker({
  preferredMinCharacters: 12,
  maximumCharacters: 160,
  maximumWaitMs: 320,
  breakOn: [".", "!", "?"],
});
assert.deepEqual(timeoutChunker.push("A stable opening phrase", 1_000), []);
assert.deepEqual(timeoutChunker.flushIfTimedOut(1_319), []);
assert.deepEqual(timeoutChunker.flushIfTimedOut(1_320), [
  "A stable opening phrase",
]);
assert.equal(
  sanitizeTextForSpeech(
    "See **details** at https://example.com and [Source](https://example.com).",
  ),
  "See details at the link in the transcript and Source.",
);

const pcm = new Uint8Array(16_000 * 2);
const wav = pcm16ToWav(pcm);
assert.equal(wav.subarray(0, 4).toString("ascii"), "RIFF");
assert.equal(wav.subarray(8, 12).toString("ascii"), "WAVE");
assert.equal(wav.length, pcm.length + 44);

console.log("Realtime Brain Calls benchmark contracts: PASS");
console.log({
  groqThreeSecondWh: Number(threeSecondWh.toFixed(4)),
  oneSecondPollingWhPerMinute: Number(sixtyOneSecondRequestsWh.toFixed(3)),
  defaultSttMode: routes.stt.mode,
  defaultTtsMode: routes.tts.mode,
});
