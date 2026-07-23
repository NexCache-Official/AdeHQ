import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { voiceBenchmarkCandidates } from "./voice-benchmark-candidates";

const required = [
  "xai-tts",
  "fish-s2.1-pro-tts",
  "cartesia-sonic-3.5-tts",
  "elevenlabs-flash-2.5-tts",
  "fish-s2-endpoint",
  "qwen3-tts-endpoint",
  "cosyvoice2-endpoint",
  "kokoro-endpoint",
  "xai-stt",
  "deepgram-flux-stt",
  "moonshine-v2-endpoint",
  "whisper-cpp-endpoint",
  "faster-whisper-endpoint",
];
assert.deepEqual(voiceBenchmarkCandidates.map((candidate) => candidate.id).sort(), [...required].sort());
assert.equal(new Set(required).size, required.length);

async function main(): Promise<void> {
const outputDir = await mkdtemp(join(tmpdir(), "adehq-voice-benchmark-"));
const env = { ...process.env };
for (const candidate of voiceBenchmarkCandidates) {
  delete env[candidate.endpointEnv];
  if (candidate.keyEnv) delete env[candidate.keyEnv];
  for (const extra of candidate.extraEnv ?? []) delete env[extra];
}
for (const name of [
  "VOICE_BENCHMARK_AUDIO_EN_US",
  "VOICE_BENCHMARK_AUDIO_EN_GB",
  "VOICE_BENCHMARK_AUDIO_ES_ES",
  "VOICE_BENCHMARK_AUDIO_FR_FR",
]) delete env[name];
env.VOICE_BENCHMARK_FULL_MATRIX = "1";

try {
  const run = spawnSync(
    resolve("node_modules/.bin/tsx"),
    ["scripts/benchmark-voice-worker-pipeline.ts", "--output-dir", outputDir],
    { cwd: resolve("."), env, encoding: "utf8" },
  );
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const report = JSON.parse(await readFile(join(outputDir, "report.json"), "utf8")) as {
    fixtures: unknown[];
    results: Array<{ status: string; reason?: string; costUsd?: number }>;
  };
  assert.equal(report.fixtures.length, 4);
  const sttCount = voiceBenchmarkCandidates.filter((candidate) => candidate.stage === "stt").length;
  const ttsCount = voiceBenchmarkCandidates.filter((candidate) => candidate.stage === "tts").length;
  assert.equal(
    report.results.length,
    (voiceBenchmarkCandidates.length + sttCount * ttsCount) * report.fixtures.length,
  );
  assert.ok(report.results.every((result) => result.status === "skipped"));
  assert.ok(report.results.every((result) => result.reason?.startsWith("missing ")));
  assert.ok(report.results.every((result) => result.costUsd === undefined));

  const csv = await readFile(join(outputDir, "report.csv"), "utf8");
  assert.equal(csv.trim().split("\n").length, report.results.length + 1);
  const blind = JSON.parse(await readFile(join(outputDir, "blind-test.json"), "utf8")) as { samples: unknown[] };
  assert.deepEqual(blind.samples, []);
} finally {
  await rm(outputDir, { recursive: true, force: true });
}

console.log("Voice benchmark no-credentials contract: PASS");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
