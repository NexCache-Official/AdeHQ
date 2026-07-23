import assert from "node:assert/strict";
import { test } from "node:test";
import { signWorkerToken } from "../src/auth.js";
import type {
  BrainApiClient,
  BrainTurnRequest,
  BrainTurnResponse,
  SfuMediaAdapter,
  SfuTrackRef,
} from "../src/boundaries.js";
import type {
  AudioFrame,
  SpeechToTextRequest,
  TextToSpeechRequest,
  TranscriptFrame,
  VoiceInferenceProvider,
} from "../src/contracts.js";
import { VoiceOrchestrator } from "../src/orchestrator.js";
import { VoiceWorkerRuntime, type VoiceOrchestratorFactory } from "../src/runtime.js";
import { createVoiceWorkerServer } from "../src/server.js";
import { LocalOnnxTurnDetector } from "../src/turn-detector.js";

const secret = "worker-secret-".repeat(3);

test("session start drives transcript through Brain to speech publish and stop", async () => {
  const fixture = createFixture(false);
  const runtime = new VoiceWorkerRuntime(fixture.factory, secret);
  const token = tokenFor("call-e2e");
  const started = await runtime.handle({
    method: "POST",
    path: "/v1/sessions",
    authorization: `Bearer ${token}`,
    body: { inputTrack: { sessionId: "human-session", trackName: "microphone" } },
  });
  assert.equal(started.status, 201);
  await eventually(() => fixture.sfu.published.length === 1);
  assert.equal(fixture.brain.requests[0]?.transcript[0]?.text, "hello worker");
  assert.deepEqual([...fixture.sfu.published[0].data], [1, 2, 3, 4]);

  const stopped = await runtime.handle({
    method: "DELETE",
    path: "/v1/sessions/call-e2e",
    authorization: `Bearer ${token}`,
  });
  assert.equal(stopped.status, 200);
  assert.equal(fixture.sfu.disconnectReason, "cancelled");
  assert.equal(runtime.sessions.size, 0);
});

test("runtime rejects missing auth and mismatched call identity", async () => {
  const fixture = createFixture(false);
  const runtime = new VoiceWorkerRuntime(fixture.factory, secret);
  const missing = await runtime.handle({
    method: "POST",
    path: "/v1/sessions",
    body: { inputTrack: { sessionId: "session", trackName: "track" } },
  });
  assert.equal(missing.status, 401);
  const malformed = await runtime.handle({
    method: "POST",
    path: "/v1/sessions",
    authorization: "Bearer not-a-jwt",
    body: { inputTrack: { sessionId: "session", trackName: "track" } },
  });
  assert.equal(malformed.status, 401);
  const mismatch = await runtime.handle({
    method: "DELETE",
    path: "/v1/sessions/another-call",
    authorization: `Bearer ${tokenFor("owned-call")}`,
  });
  assert.equal(mismatch.status, 404);
});

test("HTTP session endpoint enforces bearer authentication", async () => {
  const fixture = createFixture(false);
  const server = createVoiceWorkerServer(new VoiceWorkerRuntime(fixture.factory, secret));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        inputTrack: { sessionId: "human-session", trackName: "microphone" },
      }),
    });
    assert.equal(response.status, 401);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("interrupt aborts speech and cancels the active Brain turn", async () => {
  const fixture = createFixture(true);
  const runtime = new VoiceWorkerRuntime(fixture.factory, secret);
  const token = tokenFor("call-interrupt");
  assert.equal(
    (
      await runtime.handle({
        method: "POST",
        path: "/v1/sessions",
        authorization: `Bearer ${token}`,
        body: { inputTrack: { sessionId: "human-session", trackName: "microphone" } },
      })
    ).status,
    201,
  );
  await eventually(() => fixture.brain.requests.length === 1);
  const interrupted = await runtime.handle({
    method: "POST",
    path: "/v1/sessions/call-interrupt/interrupt",
    authorization: `Bearer ${token}`,
    body: { reason: "human_barge_in" },
  });
  assert.equal(interrupted.status, 202);
  await eventually(() => fixture.brain.cancelled.includes("brain-turn-1"));
  assert.equal(fixture.inference.speechAborted, true);
  await runtime.handle({
    method: "DELETE",
    path: "/v1/sessions/call-interrupt",
    authorization: `Bearer ${token}`,
  });
});

function createFixture(blockSpeech: boolean) {
  const sfu = new FakeSfu();
  const brain = new FakeBrain();
  const inference = new FakeInference(blockSpeech);
  const factory: VoiceOrchestratorFactory = {
    readiness: {
      inference: true,
      brain: true,
      cloudflareApi: true,
      mediaTransport: true,
    },
    create: () =>
      new VoiceOrchestrator(
        sfu,
        inference,
        brain,
        new LocalOnnxTurnDetector({ silenceTimeoutMs: 100 }),
      ),
  };
  return { factory, sfu, brain, inference };
}

class FakeSfu implements SfuMediaAdapter {
  readonly id = "fake-sfu";
  published: AudioFrame[] = [];
  disconnectReason?: string;

  async connect(): Promise<void> {}

  async *subscribe(_track: SfuTrackRef, signal: AbortSignal): AsyncIterable<AudioFrame> {
    yield frame(0, [10_000, -10_000], "input");
    await new Promise((resolve) => setTimeout(resolve, 5));
    yield frame(150, [0, 0], "input");
    await new Promise<void>((resolve) => {
      if (signal.aborted) resolve();
      else signal.addEventListener("abort", () => resolve(), { once: true });
    });
  }

  async publish(frames: AsyncIterable<AudioFrame>): Promise<SfuTrackRef> {
    for await (const value of frames) this.published.push(value);
    return { sessionId: "worker-session", trackName: "employee" };
  }

  async disconnect(reason: string): Promise<void> {
    this.disconnectReason = reason;
  }
}

class FakeBrain implements BrainApiClient {
  requests: BrainTurnRequest[] = [];
  cancelled: string[] = [];

  async createTurn(request: BrainTurnRequest): Promise<BrainTurnResponse> {
    this.requests.push(request);
    return { turnId: "brain-turn-1", text: "hello human" };
  }

  async cancelTurn(turnId: string): Promise<void> {
    this.cancelled.push(turnId);
  }
}

class FakeInference implements VoiceInferenceProvider {
  readonly id = "fake-inference";
  readonly capabilities = { streamingStt: true, streamingTts: true };
  speechAborted = false;

  constructor(private readonly blockSpeech: boolean) {}

  async *streamTranscription(request: SpeechToTextRequest): AsyncIterable<TranscriptFrame> {
    for await (const audio of request.audio) {
      yield {
        type: "transcript",
        text: "hello worker",
        isFinal: true,
        sequence: 1,
        timestampMs: audio.timestampMs,
        traceId: audio.traceId,
      };
      return;
    }
  }

  async *streamSpeech(request: TextToSpeechRequest): AsyncIterable<AudioFrame> {
    yield {
      type: "audio",
      direction: "output",
      format: request.outputFormat,
      data: new Uint8Array([1, 2, 3, 4]),
      sequence: 1,
      timestampMs: Date.now(),
      traceId: "speech",
    };
    if (!this.blockSpeech) return;
    await new Promise<void>((resolve) => {
      if (request.signal.aborted) resolve();
      else request.signal.addEventListener("abort", () => resolve(), { once: true });
    });
    this.speechAborted = request.signal.aborted;
  }
}

function tokenFor(callId: string): string {
  const now = Math.floor(Date.now() / 1000);
  return signWorkerToken(
    {
      iss: "adehq-app",
      aud: "adehq-voice-worker",
      sub: "human-1",
      workspaceId: "workspace-1",
      callId,
      scopes: ["sfu:connect", "sfu:publish", "sfu:subscribe", "brain:turn"],
      iat: now,
      exp: now + 300,
      nonce: `nonce-${callId}`,
    },
    secret,
  );
}

function frame(
  timestampMs: number,
  samples: number[],
  direction: "input" | "output",
): AudioFrame {
  const pcm = new Int16Array(samples);
  return {
    type: "audio",
    direction,
    format: { encoding: "pcm_s16le", sampleRateHz: 16_000, channels: 1 },
    data: new Uint8Array(pcm.buffer),
    sequence: timestampMs,
    timestampMs,
    traceId: "trace-e2e",
  };
}

async function eventually(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for test condition");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
