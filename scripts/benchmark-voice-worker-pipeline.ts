import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import {
  candidateConfiguration,
  voiceBenchmarkCandidates,
  type BenchmarkAudioFormat,
  type VoiceBenchmarkCandidate,
} from "./voice-benchmark-candidates";

type Status = "ok" | "skipped" | "failed";
interface Fixture { id: string; language: string; text: string; audioFileEnv: string }
interface Metrics {
  inputReadyToPhraseReady?: number;
  phraseReadyToHeaders?: number;
  phraseReadyToFirstBytes?: number;
  phraseReadyToFirstDecodableAudio?: number;
  phraseReadyToPlaybackReady?: number;
  phraseReadyToCompletion?: number;
  inputReadyToPlaybackReady?: number;
  inputReadyToCompletion?: number;
}
interface BenchmarkResult {
  runId: string; candidate: string; candidateLabel: string; family: string;
  stage: "stt" | "tts" | "pipeline"; fixture: string; language: string;
  repetition: number; concurrencySlot: number; status: Status; reason?: string;
  metricsMs?: Metrics; transcript?: string; expectedText?: string; artifact?: string;
  outputBytes?: number; costUsd?: number | null; costBasis?: string;
}
interface TtsMeasurement {
  metrics: Metrics; audio: Uint8Array; costUsd: number | null; costBasis: string;
}

export const deterministicVoiceFixtures: readonly Fixture[] = [
  { id: "en-short", language: "en-US", text: "AdeHQ prepared the brief, checked the figures, and scheduled the next review.", audioFileEnv: "VOICE_BENCHMARK_AUDIO_EN_US" },
  { id: "en-numbers", language: "en-GB", text: "The total is 1,248 pounds and 50 pence, due on Thursday at 3:15 PM.", audioFileEnv: "VOICE_BENCHMARK_AUDIO_EN_GB" },
  { id: "es-short", language: "es-ES", text: "AdeHQ preparó el informe y programó la próxima revisión para mañana.", audioFileEnv: "VOICE_BENCHMARK_AUDIO_ES_ES" },
  { id: "fr-short", language: "fr-FR", text: "AdeHQ a préparé le rapport et planifié la prochaine réunion pour demain.", audioFileEnv: "VOICE_BENCHMARK_AUDIO_FR_FR" },
] as const;

const argv = process.argv.slice(2);
const outputDir = resolve(valueAfter("--output-dir") ?? process.env.VOICE_BENCHMARK_OUTPUT_DIR ?? "artifacts/voice-benchmark");
const timeoutMs = positiveInteger(process.env.VOICE_BENCHMARK_TIMEOUT_MS, 30_000);
const playbackBufferMs = positiveInteger(process.env.VOICE_BENCHMARK_PLAYBACK_BUFFER_MS, 20);
const concurrency = positiveInteger(process.env.VOICE_BENCHMARK_CONCURRENCY, 1);
const repetitions = positiveInteger(process.env.VOICE_BENCHMARK_REPETITIONS, 1);

async function main(): Promise<void> {
  if (argv.includes("--list")) {
    console.log(JSON.stringify({ fixtures: deterministicVoiceFixtures, candidates: voiceBenchmarkCandidates }, null, 2));
    return;
  }
  await mkdir(join(outputDir, "audio"), { recursive: true });
  const wallStarted = performance.now();
  const componentResults = await runPool(makeTasks(), concurrency);
  const pipelineResults = process.env.VOICE_BENCHMARK_FULL_MATRIX === "1"
    ? await runPipelinePool(concurrency)
    : [];
  const results = [...componentResults, ...pipelineResults];
  const wallDurationMs = rounded(performance.now() - wallStarted);
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    methodology: {
      timingOrigin: "client process immediately before request construction",
      playbackReady: `first decodable audio plus ${playbackBufferMs}ms configured buffer`,
      completion: "entire response body consumed",
      physicalPlaybackMeasured: false,
      concurrency,
      repetitions,
      wallDurationMs,
      completedRequestsPerSecond: rounded(results.filter((r) => r.status === "ok").length / Math.max(wallDurationMs / 1_000, 0.001)),
    },
    fixtures: deterministicVoiceFixtures,
    results,
  };
  await Promise.all([
    writeFile(join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`),
    writeFile(join(outputDir, "report.csv"), toCsv(results)),
    writeFile(join(outputDir, "blind-test.json"), `${JSON.stringify(buildBlindSheet(results), null, 2)}\n`),
  ]);
  console.log(JSON.stringify({ outputDir, ...report }, null, 2));
}

interface Task { candidate: VoiceBenchmarkCandidate; fixture: Fixture; repetition: number }
function makeTasks(): Task[] {
  return voiceBenchmarkCandidates.flatMap((candidate) =>
    deterministicVoiceFixtures.flatMap((fixture) =>
      Array.from({ length: repetitions }, (_, index) => ({ candidate, fixture, repetition: index + 1 })),
    ),
  );
}

async function runPool(tasks: Task[], width: number): Promise<BenchmarkResult[]> {
  const output = new Array<BenchmarkResult>(tasks.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(width, tasks.length) }, async (_, workerIndex) => {
    while (cursor < tasks.length) {
      const index = cursor++;
      output[index] = await runTask(tasks[index], workerIndex + 1);
    }
  }));
  return output;
}

async function runPipelinePool(width: number): Promise<BenchmarkResult[]> {
  const stt = voiceBenchmarkCandidates.filter((candidate) => candidate.stage === "stt");
  const tts = voiceBenchmarkCandidates.filter((candidate) => candidate.stage === "tts");
  const tasks = stt.flatMap((sttCandidate) => tts.flatMap((ttsCandidate) =>
    deterministicVoiceFixtures.flatMap((fixture) =>
      Array.from({ length: repetitions }, (_, index) => ({ sttCandidate, ttsCandidate, fixture, repetition: index + 1 })),
    ),
  ));
  const output = new Array<BenchmarkResult>(tasks.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(width, tasks.length) }, async (_, workerIndex) => {
    while (cursor < tasks.length) {
      const index = cursor++;
      const task = tasks[index];
      const id = `${task.sttCandidate.id}+${task.ttsCandidate.id}`;
      const base = {
        runId: `${id}--${task.fixture.id}--r${task.repetition}`,
        candidate: id,
        candidateLabel: `${task.sttCandidate.label} → ${task.ttsCandidate.label}`,
        family: `${task.sttCandidate.family}+${task.ttsCandidate.family}`,
        stage: "pipeline" as const,
        fixture: task.fixture.id,
        language: task.fixture.language,
        repetition: task.repetition,
        concurrencySlot: workerIndex + 1,
      };
      const sttConfig = candidateConfiguration(task.sttCandidate, process.env);
      const ttsConfig = candidateConfiguration(task.ttsCandidate, process.env);
      const audioPath = process.env[task.fixture.audioFileEnv];
      const missing = [...sttConfig.missing, ...ttsConfig.missing, ...(!audioPath ? [task.fixture.audioFileEnv] : [])];
      if (missing.length) {
        output[index] = { ...base, status: "skipped", reason: `missing configuration: ${[...new Set(missing)].join(", ")}` };
        continue;
      }
      try {
        const pipelineStarted = performance.now();
        const input = await readFile(audioPath!);
        const sttResult = await benchmarkStt(task.sttCandidate, sttConfig.endpoint!, sttConfig.key, input, audioPath!);
        const phraseReadyAt = performance.now();
        const ttsResult = await benchmarkTts(task.ttsCandidate, ttsConfig.endpoint!, ttsConfig.key, sttResult.transcript);
        const extension = task.ttsCandidate.outputFormat === "pcm_s16le" ? "pcm" : task.ttsCandidate.outputFormat ?? "bin";
        const artifact = join("audio", `${blindId(base.runId)}.${extension}`);
        await writeFile(join(outputDir, artifact), ttsResult.audio);
        output[index] = {
          ...base,
          status: "ok",
          transcript: sttResult.transcript,
          expectedText: task.fixture.text,
          artifact,
          outputBytes: ttsResult.audio.byteLength,
          metricsMs: {
            inputReadyToPhraseReady: rounded(phraseReadyAt - pipelineStarted),
            ...ttsResult.metrics,
            inputReadyToPlaybackReady: rounded(phraseReadyAt - pipelineStarted + (ttsResult.metrics.phraseReadyToPlaybackReady ?? 0)),
            inputReadyToCompletion: rounded(performance.now() - pipelineStarted),
          },
          costUsd: sttResult.costUsd === null || ttsResult.costUsd === null ? null : roundedMoney(sttResult.costUsd + ttsResult.costUsd),
          costBasis: `STT: ${sttResult.costBasis}; TTS: ${ttsResult.costBasis}`,
        };
      } catch (error) {
        output[index] = { ...base, status: "failed", reason: safeError(error) };
      }
    }
  }));
  return output;
}

async function runTask(task: Task, concurrencySlot: number): Promise<BenchmarkResult> {
  const { candidate, fixture, repetition } = task;
  const base = resultBase(candidate, fixture, repetition, concurrencySlot);
  const configured = candidateConfiguration(candidate, process.env);
  if (configured.missing.length) {
    return { ...base, status: "skipped", reason: `missing configuration: ${configured.missing.join(", ")}` };
  }
  try {
    if (candidate.stage === "tts") {
      const measured = await benchmarkTts(candidate, configured.endpoint!, configured.key, fixture.text);
      const extension = candidate.outputFormat === "pcm_s16le" ? "pcm" : candidate.outputFormat ?? "bin";
      const artifact = join("audio", `${blindId(base.runId)}.${extension}`);
      await writeFile(join(outputDir, artifact), measured.audio);
      return { ...base, status: "ok", metricsMs: measured.metrics, artifact, outputBytes: measured.audio.byteLength, costUsd: measured.costUsd, costBasis: measured.costBasis };
    }
    const audioPath = process.env[fixture.audioFileEnv];
    if (!audioPath) return { ...base, status: "skipped", reason: `missing fixture audio: ${fixture.audioFileEnv}` };
    const input = await readFile(audioPath);
    const stt = await benchmarkStt(candidate, configured.endpoint!, configured.key, input, audioPath);
    return {
      ...base, status: "ok", transcript: stt.transcript, expectedText: fixture.text,
      metricsMs: { inputReadyToPhraseReady: stt.phraseReadyMs, inputReadyToCompletion: stt.completionMs },
      costUsd: stt.costUsd, costBasis: stt.costBasis,
    };
  } catch (error) {
    return { ...base, status: "failed", reason: safeError(error) };
  }
}

function resultBase(candidate: VoiceBenchmarkCandidate, fixture: Fixture, repetition: number, concurrencySlot: number) {
  return {
    runId: `${candidate.id}--${fixture.id}--r${repetition}`,
    candidate: candidate.id,
    candidateLabel: candidate.label,
    family: candidate.family,
    stage: candidate.stage,
    fixture: fixture.id,
    language: fixture.language,
    repetition,
    concurrencySlot,
  };
}

async function benchmarkStt(candidate: VoiceBenchmarkCandidate, endpoint: string, key: string | undefined, input: Buffer, audioFile: string) {
  const started = performance.now();
  const headers = authHeaders(candidate, key);
  let body: BodyInit;
  if (candidate.id === "deepgram-flux-stt") {
    headers.set("content-type", process.env.VOICE_BENCHMARK_AUDIO_CONTENT_TYPE ?? "audio/wav");
    body = Uint8Array.from(input);
  } else {
    const form = new FormData();
    form.set("file", new Blob([Uint8Array.from(input)], { type: process.env.VOICE_BENCHMARK_AUDIO_CONTENT_TYPE ?? "audio/wav" }), basename(audioFile));
    form.set("model", candidate.model ?? "default");
    body = form;
  }
  const response = await fetch(endpoint, { method: "POST", headers, body, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`request failed with HTTP ${response.status}`);
  const payload = await response.json() as unknown;
  const completed = performance.now();
  const transcript = extractTranscript(payload);
  if (!transcript) throw new Error("response did not contain a recognized transcript field");
  const audioSeconds = wavDurationSeconds(input);
  const rate = optionalRate(candidate.costPerUnitEnv);
  return {
    transcript,
    phraseReadyMs: rounded(completed - started),
    completionMs: rounded(completed - started),
    costUsd: rate === undefined || audioSeconds === undefined ? null : roundedMoney((audioSeconds / 3_600) * rate),
    costBasis: rate === undefined ? `unpriced; set ${candidate.costPerUnitEnv}` : audioSeconds === undefined ? "unpriced; fixture duration unavailable" : `${rounded(audioSeconds)} audio seconds at $${rate}/audio hour`,
  };
}

async function benchmarkTts(candidate: VoiceBenchmarkCandidate, endpoint: string, key: string | undefined, text: string): Promise<TtsMeasurement> {
  const phraseReady = performance.now();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: authHeaders(candidate, key, true),
    body: JSON.stringify(ttsBody(candidate, text)),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const headersAt = performance.now();
  if (!response.ok) throw new Error(`request failed with HTTP ${response.status}`);
  if (!response.body) throw new Error("response had no body");
  const reader = response.body.getReader();
  let firstBytesAt: number | undefined;
  let firstDecodableAt: number | undefined;
  let audio: Uint8Array<ArrayBufferLike> = new Uint8Array();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value?.byteLength) continue;
    firstBytesAt ??= performance.now();
    audio = concat(audio, value);
    if (firstDecodableAt === undefined && isDecodablePrefix(audio, candidate.outputFormat ?? "pcm_s16le")) firstDecodableAt = performance.now();
  }
  const completedAt = performance.now();
  if (firstBytesAt === undefined || firstDecodableAt === undefined) throw new Error("response ended before decodable audio was observed");
  const duration = audioDurationSeconds(audio, candidate.outputFormat ?? "pcm_s16le");
  const rate = optionalRate(candidate.costPerUnitEnv);
  const cost = rate === undefined ? null : candidate.costUnit === "million_characters"
    ? roundedMoney((text.length / 1_000_000) * rate)
    : duration === undefined ? null : roundedMoney((duration / 3_600) * rate);
  const costBasis = rate === undefined
    ? `unpriced; set ${candidate.costPerUnitEnv}`
    : candidate.costUnit === "million_characters"
      ? `${text.length} characters at $${rate}/million characters`
      : duration === undefined ? "unpriced; output duration unavailable" : `${rounded(duration)} audio seconds at $${rate}/audio hour`;
  return {
    audio, costUsd: cost, costBasis,
    metrics: {
      phraseReadyToHeaders: rounded(headersAt - phraseReady),
      phraseReadyToFirstBytes: rounded(firstBytesAt - phraseReady),
      phraseReadyToFirstDecodableAudio: rounded(firstDecodableAt - phraseReady),
      phraseReadyToPlaybackReady: rounded(firstDecodableAt - phraseReady + playbackBufferMs),
      phraseReadyToCompletion: rounded(completedAt - phraseReady),
    },
  };
}

function ttsBody(candidate: VoiceBenchmarkCandidate, text: string): unknown {
  if (candidate.id === "xai-tts") return {
    text,
    voice_id: process.env.XAI_TTS_VOICE_ID ?? "eve",
    language: "auto",
    output_format: { codec: "mp3" },
    speed: 1,
    optimize_streaming_latency: 1,
  };
  if (candidate.id === "cartesia-sonic-3.5-tts") return {
    model_id: process.env.CARTESIA_TTS_MODEL ?? candidate.model,
    transcript: text,
    voice: { mode: "id", id: process.env.CARTESIA_VOICE_ID },
    output_format: { container: "raw", encoding: "pcm_s16le", sample_rate: 24_000 },
  };
  if (candidate.id === "elevenlabs-flash-2.5-tts") return { text, model_id: candidate.model, output_format: "mp3_44100_128" };
  if (candidate.id === "fish-s2.1-pro-tts") return { text, format: "mp3", latency: "normal", reference_id: process.env.FISH_AUDIO_REFERENCE_ID || undefined };
  return { text, model: candidate.model, stream: true, format: candidate.outputFormat ?? "pcm_s16le", sample_rate_hz: 24_000 };
}

function authHeaders(candidate: VoiceBenchmarkCandidate, key: string | undefined, json = false): Headers {
  const headers = new Headers();
  if (json) headers.set("content-type", "application/json");
  if (!key) return headers;
  if (candidate.id === "deepgram-flux-stt") headers.set("authorization", `Token ${key}`);
  else if (candidate.id === "cartesia-sonic-3.5-tts") {
    headers.set("x-api-key", key);
    headers.set("cartesia-version", "2025-04-16");
  } else if (candidate.id === "elevenlabs-flash-2.5-tts") headers.set("xi-api-key", key);
  else headers.set("authorization", `Bearer ${key}`);
  if (candidate.id === "fish-s2.1-pro-tts") headers.set("model", candidate.model ?? "s2.1-pro");
  return headers;
}

function extractTranscript(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const value = payload as Record<string, unknown>;
  if (typeof value.text === "string") return value.text;
  if (typeof value.transcript === "string") return value.transcript;
  const results = value.results as Record<string, unknown> | undefined;
  const channels = results?.channels;
  if (!Array.isArray(channels)) return undefined;
  const alternatives = (channels[0] as Record<string, unknown> | undefined)?.alternatives;
  const transcript = Array.isArray(alternatives) ? (alternatives[0] as Record<string, unknown> | undefined)?.transcript : undefined;
  return typeof transcript === "string" ? transcript : undefined;
}

function buildBlindSheet(results: BenchmarkResult[]) {
  return {
    instructions: "Randomize playback order, use headphones, and score without opening report.json. Keep the key sealed until scoring is complete.",
    scale: { naturalness: "1-5", intelligibility: "1-5", pronunciation: "1-5", preferenceRank: "1=best within fixture" },
    samples: results.filter((r) => r.status === "ok").map((r) => ({
      blindId: blindId(r.runId),
      mediaType: r.artifact ? "audio" : "transcript",
      fixture: r.fixture,
      language: r.language,
      artifact: r.artifact,
      transcript: r.transcript,
      expectedText: r.expectedText,
      naturalness: null,
      intelligibility: null,
      pronunciation: null,
      preferenceRank: null,
      notes: "",
    })).sort((a, b) => a.blindId.localeCompare(b.blindId)),
  };
}

function blindId(runId: string): string {
  return createHash("sha256").update(runId).digest("hex").slice(0, 10);
}

function toCsv(results: BenchmarkResult[]): string {
  const columns = ["runId", "candidate", "candidateLabel", "family", "stage", "fixture", "language", "repetition", "concurrencySlot", "status", "reason", "inputReadyToPhraseReadyMs", "phraseReadyToFirstDecodableAudioMs", "phraseReadyToPlaybackReadyMs", "phraseReadyToCompletionMs", "inputReadyToPlaybackReadyMs", "inputReadyToCompletionMs", "costUsd", "costBasis", "outputBytes", "artifact", "transcript", "expectedText"];
  const rows = results.map((r) => [
    r.runId, r.candidate, r.candidateLabel, r.family, r.stage, r.fixture, r.language, r.repetition, r.concurrencySlot, r.status, r.reason,
    r.metricsMs?.inputReadyToPhraseReady, r.metricsMs?.phraseReadyToFirstDecodableAudio, r.metricsMs?.phraseReadyToPlaybackReady,
    r.metricsMs?.phraseReadyToCompletion, r.metricsMs?.inputReadyToPlaybackReady, r.metricsMs?.inputReadyToCompletion,
    r.costUsd, r.costBasis, r.outputBytes, r.artifact, r.transcript, r.expectedText,
  ]);
  return `${[columns, ...rows].map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}
function csvCell(value: unknown): string {
  if (value === undefined || value === null) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function isDecodablePrefix(bytes: Uint8Array, format: BenchmarkAudioFormat): boolean {
  if (format === "pcm_s16le") return bytes.byteLength >= 2;
  if (format === "wav") return bytes.byteLength >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WAVE";
  if (format === "opus") return bytes.byteLength >= 4 && ascii(bytes, 0, 4) === "OggS";
  return (bytes.byteLength >= 3 && ascii(bytes, 0, 3) === "ID3") || (bytes.byteLength >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
}
function audioDurationSeconds(bytes: Uint8Array, format: BenchmarkAudioFormat): number | undefined {
  if (format === "pcm_s16le") return bytes.byteLength / (24_000 * 2);
  if (format === "wav") return wavDurationSeconds(bytes);
  return undefined;
}
function wavDurationSeconds(bytes: Uint8Array): number | undefined {
  if (bytes.byteLength < 44 || ascii(bytes, 0, 4) !== "RIFF") return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const byteRate = view.getUint32(28, true);
  const dataBytes = view.getUint32(40, true);
  return byteRate > 0 ? dataBytes / byteRate : undefined;
}
function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
  const joined = new Uint8Array(left.byteLength + right.byteLength);
  joined.set(left); joined.set(right, left.byteLength); return joined;
}
function ascii(bytes: Uint8Array, start: number, end: number): string { return String.fromCharCode(...bytes.subarray(start, end)); }
function optionalRate(name: string): number | undefined {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 0 && process.env[name] !== "" && process.env[name] !== undefined ? parsed : undefined;
}
function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
function valueAfter(flag: string): string | undefined {
  const index = argv.indexOf(flag); return index >= 0 ? argv[index + 1] : undefined;
}
function rounded(value: number): number { return Number(value.toFixed(2)); }
function roundedMoney(value: number): number { return Number(value.toFixed(8)); }
function safeError(error: unknown): string {
  return error instanceof Error ? error.message.replace(/https?:\/\/\S+/g, "[endpoint]") : "unknown error";
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "failed", reason: safeError(error) }));
  process.exitCode = 1;
});
