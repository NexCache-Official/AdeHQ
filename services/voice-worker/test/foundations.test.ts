import assert from "node:assert/strict";
import { test } from "node:test";
import { signWorkerToken, verifyWorkerToken } from "../src/auth.js";
import { createVoiceWorkerRuntime } from "../src/bootstrap.js";
import type { CloudflarePeerTransport } from "../src/cloudflare.js";
import type { AudioFrame } from "../src/contracts.js";
import { FramePipeline } from "../src/pipeline.js";
import { LocalOnnxTurnDetector } from "../src/turn-detector.js";

test("ephemeral tokens enforce signature, scope, and five-minute ceiling", () => {
  const secret = "a".repeat(32);
  const claims = {
    iss: "adehq-app" as const,
    aud: "adehq-voice-worker" as const,
    sub: "participant-1",
    workspaceId: "workspace-1",
    callId: "call-1",
    scopes: ["brain:turn" as const],
    iat: 1_000,
    exp: 1_120,
    nonce: "nonce-1",
  };
  const token = signWorkerToken(claims, secret);
  assert.equal(verifyWorkerToken(token, secret, ["brain:turn"], 1_001).callId, "call-1");
  assert.throws(() => verifyWorkerToken(token, secret, ["sfu:publish"], 1_001), /scope/);
  assert.throws(() => verifyWorkerToken(`${token}x`, secret, [], 1_001), /signature/);
  assert.throws(
    () => signWorkerToken({ ...claims, exp: 1_301 }, secret),
    /five minutes|overlong/,
  );
});

test("frame pipeline propagates output and aborts on interrupt", async () => {
  const seen: string[] = [];
  const pipeline = new FramePipeline([
    {
      name: "pass-through",
      async process(frame) {
        return [frame];
      },
    },
  ]);
  pipeline.onFrame((frame) => seen.push(frame.type));
  await pipeline.push({
    type: "control",
    event: "flush",
    sequence: 1,
    timestampMs: 1,
    traceId: "trace",
  });
  assert.deepEqual(seen, ["control"]);
  await pipeline.interrupt({
    sequence: 2,
    timestampMs: 2,
    traceId: "trace",
    reason: "barge-in",
  });
  assert.equal(pipeline.signal.aborted, true);
  await pipeline.close("cancelled");
});

test("missing ONNX weights fail safe to energy VAD timeout", async () => {
  const detector = new LocalOnnxTurnDetector({ silenceTimeoutMs: 100 });
  assert.deepEqual(detector.status, {
    silero: "unavailable",
    smartTurn: "unavailable",
    fallback: "energy-vad-timeout",
  });
  const signal = new AbortController().signal;
  const loud = audioFrame(0, new Int16Array([10_000, -10_000]));
  const quiet = audioFrame(150, new Int16Array([0, 0]));
  assert.equal((await detector.observeAudio(loud, signal))[0]?.event, "speech_started");
  assert.deepEqual(
    (await detector.observeAudio(quiet, signal)).map((event) => [event.event, event.reason]),
    [
      ["speech_stopped", "vad"],
      ["turn_ready", "timeout"],
    ],
  );
});

test("readiness rejects incomplete or weak runtime configuration", () => {
  assert.equal(createVoiceWorkerRuntime({ NODE_ENV: "test" }).readiness().ready, false);
  const configured: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    ADEHQ_BRAIN_API_BASE_URL: "https://example.test",
    ADEHQ_WORKER_TOKEN_SECRET: "x".repeat(32),
    CLOUDFLARE_REALTIME_APP_ID: "app",
    CLOUDFLARE_REALTIME_API_TOKEN: "secret",
    XAI_API_KEY: "xai",
  };
  assert.equal(createVoiceWorkerRuntime(configured).readiness().ready, false);
  assert.equal(
    createVoiceWorkerRuntime(configured).readiness().capabilities.mediaTransport,
    false,
  );
  const peerFactory = () =>
    ({
      id: "test-peer",
      configured: true,
      createOffer: async () => ({ type: "offer", sdp: "test-offer" }),
      acceptAnswer: async () => undefined,
      subscribe: async function* () {},
      publish: async () => undefined,
      close: async () => undefined,
    }) satisfies CloudflarePeerTransport;
  assert.equal(createVoiceWorkerRuntime(configured, { peerFactory }).readiness().ready, true);
});

function audioFrame(timestampMs: number, samples: Int16Array): AudioFrame {
  return {
    type: "audio",
    direction: "input",
    format: { encoding: "pcm_s16le", sampleRateHz: 16_000, channels: 1 },
    data: new Uint8Array(samples.buffer),
    sequence: timestampMs,
    timestampMs,
    traceId: "trace",
  };
}
