import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  STANDARD_TTS_INTERNAL_USD_PER_CALL,
  billableCallMinutes,
  calendarMonthPeriod,
  resolveVoicePlanEntitlements,
  standardTtsCostSplit,
} from "../src/lib/billing/voice/usage";
import { isIncludedLiveCallSpeech } from "../src/lib/brain/metering/record-brain-usage";

const expectedMinutes: Record<string, number | null> = {
  free: 0,
  pro: 120,
  team: 500,
  business: 2_000,
  enterprise: null,
};

for (const [plan, allowance] of Object.entries(expectedMinutes)) {
  const voice = resolveVoicePlanEntitlements(plan, {});
  assert.equal(
    voice.monthlyLiveCallMinutes,
    allowance,
    `${plan} launch minute allowance`,
  );
  assert.equal(voice.standardTtsInternalUsdPerCall, 0.02);
  assert.equal(voice.standardTtsCustomerWhPerCall, 0);
  assert.equal(voice.standardTtsTreatment, "platform_absorbed");
  assert.equal(voice.premiumTtsTreatment, "customer_charged");
  assert.equal(voice.sttTreatment, "platform_absorbed");
  assert.equal(voice.transcriptIncluded, true);
  assert.equal(voice.captionsIncluded, true);
}

assert.equal(STANDARD_TTS_INTERNAL_USD_PER_CALL, 0.02);
assert.deepEqual(standardTtsCostSplit(0.015, 0.02), {
  platformAbsorbedUsd: 0.015,
  customerChargedUsd: 0,
});
assert.deepEqual(standardTtsCostSplit(0.05, 0.02), {
  platformAbsorbedUsd: 0.02,
  customerChargedUsd: 0.03,
});
assert.equal(
  isIncludedLiveCallSpeech({
    runtimeMode: "voice_call",
    capability: "speech_to_text",
    routeId: "route_call_stt_groq_turbo",
  }),
  true,
);
assert.equal(
  isIncludedLiveCallSpeech({
    runtimeMode: "voice_call",
    capability: "text_to_speech",
    routeId: "route_tts_cosyvoice2",
  }),
  true,
);
assert.equal(
  isIncludedLiveCallSpeech({
    runtimeMode: "voice_call",
    capability: "text_to_speech",
    routeId: "route_call_tts_xai",
    metadata: { voiceTier: "standard" },
  }),
  true,
);
assert.equal(
  isIncludedLiveCallSpeech({
    runtimeMode: "voice_call",
    capability: "text_to_speech",
    routeId: "route_call_tts_fish",
    metadata: { voiceTier: "standard" },
  }),
  true,
);
assert.equal(
  isIncludedLiveCallSpeech({
    runtimeMode: "voice_call",
    capability: "text_to_speech",
    routeId: "route_call_tts_xai",
    metadata: { voiceTier: "premium" },
  }),
  false,
);
assert.equal(billableCallMinutes(0), 0);
assert.equal(billableCallMinutes(30), 0.5);
assert.equal(billableCallMinutes(90), 1.5);
assert.equal(billableCallMinutes(Number.NaN), 0);

assert.deepEqual(calendarMonthPeriod(new Date("2026-12-31T23:59:59Z")), {
  periodStart: "2026-12-01T00:00:00.000Z",
  periodEnd: "2027-01-01T00:00:00.000Z",
});

const override = resolveVoicePlanEntitlements("pro", {
  voice: {
    monthly_live_call_minutes: 321,
    standard_tts_internal_usd_per_call: 0.03,
    premium_tts_treatment: "internal_only",
  },
});
assert.equal(override.monthlyLiveCallMinutes, 321);
assert.equal(override.standardTtsInternalUsdPerCall, 0.03);
assert.equal(override.premiumTtsTreatment, "internal_only");

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260723174456_voice_billing_economics.sql",
  ),
  "utf8",
);
assert.match(migration, /idempotency_key text not null unique/i);
assert.match(migration, /on conflict \(idempotency_key\) do nothing/i);
assert.match(migration, /customer_charged_wh[^;]+default 0/is);
assert.match(migration, /standard_tts_internal_usd_per_call', 0\.02/);
assert.match(migration, /alter table public\.voice_usage_ledger enable row level security/i);
assert.match(
  migration,
  /revoke execute on function public\.burn_live_call_minutes[\s\S]+authenticated/i,
);

console.log("Voice billing invariants passed.");
