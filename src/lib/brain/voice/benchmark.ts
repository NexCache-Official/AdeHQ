/**
 * STT route selection benchmark harness (offline scoring helpers).
 * Live provider runs stay behind ADEHQ_VOICE_BENCHMARK_LIVE=1.
 */

import { selectSttRoute } from "./select";
import type { SttRouteId } from "./types";

export type SttBenchmarkCase = {
  id: string;
  label: string;
  accent?: "uk" | "indian" | "bulgarian" | "american";
  noisy?: boolean;
  multiSpeaker?: boolean;
  technical?: boolean;
  durationSeconds: number;
  expectRoute: SttRouteId | SttRouteId[];
};

export const STT_BENCHMARK_CASES: SttBenchmarkCase[] = [
  {
    id: "vn_quiet_us",
    label: "Quiet American voice note",
    accent: "american",
    durationSeconds: 12,
    expectRoute: "route_stt_fast",
  },
  {
    id: "vn_uk",
    label: "UK accent voice note",
    accent: "uk",
    durationSeconds: 20,
    expectRoute: ["route_stt_fast", "route_stt_accurate"],
  },
  {
    id: "vn_indian_tech",
    label: "Indian accent + technical terms",
    accent: "indian",
    technical: true,
    durationSeconds: 35,
    expectRoute: "route_stt_accurate",
  },
  {
    id: "vn_bulgarian_office",
    label: "Bulgarian accent in office noise",
    accent: "bulgarian",
    noisy: true,
    durationSeconds: 40,
    expectRoute: "route_stt_accurate",
  },
  {
    id: "meeting_multi",
    label: "Multi-speaker meeting",
    multiSpeaker: true,
    durationSeconds: 420,
    expectRoute: "route_stt_diarized",
  },
  {
    id: "long_mono",
    label: "Long monologue",
    durationSeconds: 240,
    expectRoute: "route_stt_accurate",
  },
];

export function scoreSttRouteSelection(): {
  passed: number;
  total: number;
  failures: Array<{ id: string; got: SttRouteId; expected: SttRouteId | SttRouteId[] }>;
} {
  const failures: Array<{
    id: string;
    got: SttRouteId;
    expected: SttRouteId | SttRouteId[];
  }> = [];
  let passed = 0;

  for (const c of STT_BENCHMARK_CASES) {
    const got = selectSttRoute({
      intent: c.multiSpeaker || c.durationSeconds >= 300 ? "meeting" : "voice_note",
      durationSeconds: c.durationSeconds,
      requireDiarization: c.multiSpeaker,
      noisyHint: c.noisy,
      technicalHint: c.technical,
    });
    const expected = Array.isArray(c.expectRoute) ? c.expectRoute : [c.expectRoute];
    if (expected.includes(got)) passed += 1;
    else failures.push({ id: c.id, got, expected: c.expectRoute });
  }

  return { passed, total: STT_BENCHMARK_CASES.length, failures };
}
