/**
 * PR-18 Voice — unit tests (route selection, policy, metering units, benchmark).
 *
 *   npm run test:brain:voice
 */
import { CATALOG_VERSION } from "../src/lib/brain/catalog/version";
import { getBrainRoute, getLiveSeedSnapshot } from "../src/lib/brain/catalog";
import { costUsdFromSnapshot } from "../src/lib/brain/catalog/pricing-snapshots";
import { computeUsageCost } from "../src/lib/brain/metering";
import {
  selectSttRoute,
  routeIdForTtsIntent,
  estimatedWhForTts,
  estimatedWhForStt,
  shouldUseAsyncStt,
  evaluateTtsPolicy,
  evaluateSttPolicy,
  DEFAULT_WORKSPACE_VOICE_SETTINGS,
  scoreSttRouteSelection,
} from "../src/lib/brain/voice";
import { buildSegmentsFromTranscript } from "../src/lib/brain/voice/adapter";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("\n=== PR-18 Voice foundation ===\n");

check("catalog version is 8", CATALOG_VERSION === "8");

check(
  "TTS default route is CosyVoice label route",
  routeIdForTtsIntent("read_aloud") === "route_tts_cosyvoice2",
);
check(
  "premium TTS route selected",
  routeIdForTtsIntent("premium_voiceover") === "route_tts_fish_speech",
);

check(
  "TTS production routes enabled",
  Boolean(getBrainRoute("route_tts_cosyvoice2")?.enabled) &&
    getBrainRoute("route_tts_cosyvoice2")?.environment === "production",
);
check(
  "STT fast route assigned to SiliconFlow",
  getBrainRoute("route_stt_fast")?.provider === "siliconflow" &&
    getBrainRoute("route_stt_fast")?.enabled === true,
);

const ttsSnap = getLiveSeedSnapshot("route_tts_cosyvoice2");
check("TTS pricing snapshot exists", Boolean(ttsSnap?.perThousandUtf8Bytes));
const sttSnap = getLiveSeedSnapshot("route_stt_fast");
check("STT pricing snapshot exists", Boolean(sttSnap?.perAudioSecond));

const ttsCost = computeUsageCost({
  routeId: "route_tts_cosyvoice2",
  usage: { ttsUtf8Bytes: 2750 },
});
check("TTS metering charges from utf8 bytes", ttsCost.costUsd > 0);

const sttCost = computeUsageCost({
  routeId: "route_stt_fast",
  usage: { audioSeconds: 60 },
});
check("STT metering charges from audio seconds", sttCost.costUsd > 0);

check(
  "snapshot STT math matches",
  Boolean(
    sttSnap &&
      Math.abs(costUsdFromSnapshot(sttSnap, { audioSeconds: 60 }) - sttCost.costUsd) < 1e-9,
  ),
);

check("voice note WH estimate positive", estimatedWhForStt("voice_note", 60) > 0);
check(
  "TTS WH estimate scales with bytes",
  estimatedWhForTts("read_aloud", 2000) > estimatedWhForTts("read_aloud", 500),
);
check("async threshold at 120s", shouldUseAsyncStt(120) && !shouldUseAsyncStt(30));

check(
  "selectSttRoute escalates technical",
  selectSttRoute({
    intent: "voice_note",
    durationSeconds: 20,
    technicalHint: true,
  }) === "route_stt_accurate",
);
check(
  "selectSttRoute meeting → diarized",
  selectSttRoute({
    intent: "meeting",
    durationSeconds: 400,
    requireDiarization: true,
  }) === "route_stt_diarized",
);

const ttsBlocked = evaluateTtsPolicy({
  intent: "premium_voiceover",
  text: "Hello",
  remainingWh: 100,
  settings: { ...DEFAULT_WORKSPACE_VOICE_SETTINGS, premiumVoicesAllowed: false },
  voiceEnabledPlatform: true,
});
check("premium TTS blocked without workspace allow", ttsBlocked.action === "blocked");

const sttConfirm = evaluateSttPolicy({
  intent: "meeting",
  durationSeconds: 300,
  remainingWh: 50,
  settings: DEFAULT_WORKSPACE_VOICE_SETTINGS,
  voiceEnabledPlatform: true,
  confirmed: false,
});
check("long meeting requires estimate confirm", sttConfirm.action === "confirm_estimate");

const sttOff = evaluateSttPolicy({
  intent: "voice_note",
  durationSeconds: 10,
  remainingWh: 50,
  settings: DEFAULT_WORKSPACE_VOICE_SETTINGS,
  voiceEnabledPlatform: false,
});
check("platform voice flag blocks STT", sttOff.action === "blocked");

const segs = buildSegmentsFromTranscript("Hello world. Second sentence.", 10);
check("segments produced from transcript", segs.length >= 2 && segs[0]!.startMs === 0);

const bench = scoreSttRouteSelection();
check(
  `STT benchmark cases ${bench.passed}/${bench.total}`,
  bench.passed === bench.total,
  bench.failures.map((f) => `${f.id}:${f.got}`).join(", "),
);

const labels = [
  getBrainRoute("route_tts_cosyvoice2")?.label,
  getBrainRoute("route_stt_fast")?.label,
];
check(
  "member labels omit model SKUs",
  labels.every((l) => l && !/CosyVoice|SenseVoice|Fish/i.test(l)),
);

console.log(`\n${failed ? `Failed: ${failed}` : "All voice foundation checks passed."}\n`);
process.exit(failed ? 1 : 0);
