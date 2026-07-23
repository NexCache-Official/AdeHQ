import type { SupabaseClient } from "@supabase/supabase-js";
import {
  GroqWhisperAdapter,
  SiliconFlowStreamingTtsAdapter,
  XaiTtsAdapter,
} from "./live-adapters";
import type {
  CallSttMode,
  LiveCallEntitlements,
  SpeechToTextAdapter,
  TextToSpeechAdapter,
} from "./live-types";

export type SpeechRouteContext = {
  callMode: CallSttMode;
  language?: string;
  region?: string;
  truePartialsRequired?: boolean;
  premiumVoiceRequested?: boolean;
  previousTranscriptionFailures?: number;
  lowConfidence?: boolean;
  entitlements: LiveCallEntitlements;
};

export type SpeechRouteSelection = {
  stt: SpeechToTextAdapter;
  tts: TextToSpeechAdapter;
  sttMemberLabel: "Fast transcription" | "Live captions" | "Accurate transcription";
  ttsMemberLabel: "Standard voice" | "Premium voice";
};

export function selectSpeechRoutes(context: SpeechRouteContext): SpeechRouteSelection {
  if (context.truePartialsRequired || context.callMode === "live_streaming") {
    throw new Error(
      "Live captions require a configured true-streaming STT adapter; Groq cannot provide partials.",
    );
  }

  const accurate =
    context.lowConfidence || (context.previousTranscriptionFailures ?? 0) > 0;
  const premium =
    context.premiumVoiceRequested && context.entitlements.premiumVoiceEnabled;

  return {
    stt: new GroqWhisperAdapter(
      accurate ? "whisper-large-v3" : "whisper-large-v3-turbo",
    ),
    tts: premium ? new XaiTtsAdapter() : new SiliconFlowStreamingTtsAdapter(),
    sttMemberLabel: accurate ? "Accurate transcription" : "Fast transcription",
    ttsMemberLabel: premium ? "Premium voice" : "Standard voice",
  };
}

const PLAN_DEFAULTS: Record<string, LiveCallEntitlements> = {
  free: {
    enabled: false,
    maxConcurrentCallsPerWorkspace: 1,
    maxConcurrentCallsPerHuman: 1,
    maxCallDurationMinutes: 5,
    maxIdleMinutes: 2,
    maxTurnWh: 2,
    premiumVoiceEnabled: false,
    recordingEnabled: false,
    transcriptRetentionDays: 30,
  },
  pro: {
    enabled: true,
    maxConcurrentCallsPerWorkspace: 1,
    maxConcurrentCallsPerHuman: 1,
    maxCallDurationMinutes: 30,
    maxIdleMinutes: 5,
    maxTurnWh: 5,
    premiumVoiceEnabled: true,
    recordingEnabled: true,
    transcriptRetentionDays: 90,
  },
  team: {
    enabled: true,
    maxConcurrentCallsPerWorkspace: 3,
    maxConcurrentCallsPerHuman: 1,
    maxCallDurationMinutes: 60,
    maxIdleMinutes: 10,
    maxTurnWh: 8,
    premiumVoiceEnabled: true,
    recordingEnabled: true,
    transcriptRetentionDays: 180,
  },
  business: {
    enabled: true,
    maxConcurrentCallsPerWorkspace: 10,
    maxConcurrentCallsPerHuman: 2,
    maxCallDurationMinutes: 120,
    maxIdleMinutes: 15,
    maxTurnWh: 15,
    premiumVoiceEnabled: true,
    recordingEnabled: true,
    transcriptRetentionDays: 365,
  },
  enterprise: {
    enabled: true,
    maxConcurrentCallsPerWorkspace: 25,
    maxConcurrentCallsPerHuman: 3,
    maxCallDurationMinutes: 240,
    maxIdleMinutes: 30,
    maxTurnWh: 30,
    premiumVoiceEnabled: true,
    recordingEnabled: true,
    transcriptRetentionDays: null,
  },
};

function mergeEntitlements(
  base: LiveCallEntitlements,
  raw: Record<string, unknown>,
): LiveCallEntitlements {
  const call = (raw.live_calls && typeof raw.live_calls === "object"
    ? raw.live_calls
    : raw) as Partial<LiveCallEntitlements>;
  return {
    ...base,
    ...Object.fromEntries(
      Object.entries(call).filter(([, value]) => value !== undefined),
    ),
  } as LiveCallEntitlements;
}

function positiveEnvNumber(name: string): number | null {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export async function resolveLiveCallEntitlements(
  client: SupabaseClient,
  workspaceId: string,
): Promise<LiveCallEntitlements> {
  const { resolveWorkspacePlan } = await import(
    "@/lib/billing/plans/resolve-workspace-plan"
  );
  const plan = await resolveWorkspacePlan(client, workspaceId);
  const defaults = PLAN_DEFAULTS[plan.planSlug] ?? PLAN_DEFAULTS.free;
  const resolved = mergeEntitlements(defaults, plan.config.entitlements ?? {});
  const maxCallDurationMinutes = positiveEnvNumber("ADEHQ_CALL_MAX_DURATION_MINUTES");
  const maxTurnWh = positiveEnvNumber("ADEHQ_CALL_MAX_TURN_WH");
  const operationallyBound = {
    ...resolved,
    maxCallDurationMinutes: maxCallDurationMinutes ?? resolved.maxCallDurationMinutes,
    maxTurnWh: maxTurnWh ?? resolved.maxTurnWh,
  };
  if (process.env.ADEHQ_LIVE_CALLS_V1 !== "1") {
    return { ...operationallyBound, enabled: false };
  }
  const rollout = process.env.ADEHQ_LIVE_CALLS_ROLLOUT ?? "off";
  const allowlisted = new Set(
    (process.env.ADEHQ_LIVE_CALL_WORKSPACE_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  const internal = new Set(
    (process.env.ADEHQ_INTERNAL_WORKSPACE_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  const rolloutEnabled =
    rollout === "all_entitled_workspaces" ||
    (rollout === "allowlisted_workspaces" && allowlisted.has(workspaceId)) ||
    (rollout === "internal" && internal.has(workspaceId));
  // Alpha override: allow Pro-like call entitlements while validating providers.
  const alphaForce =
    process.env.ADEHQ_LIVE_CALLS_ALPHA === "1" ||
    process.env.ADEHQ_LIVE_CALLS_ALPHA === "true";
  if (alphaForce && rolloutEnabled) {
    return {
      ...operationallyBound,
      enabled: true,
      // Alpha validates the full call stack, including premium TTS when configured.
      premiumVoiceEnabled: true,
      maxCallDurationMinutes: Math.max(operationallyBound.maxCallDurationMinutes, 30),
      maxIdleMinutes: Math.max(operationallyBound.maxIdleMinutes, 5),
      maxTurnWh: Math.max(operationallyBound.maxTurnWh, 5),
      recordingEnabled: true,
    };
  }
  return {
    ...operationallyBound,
    enabled: operationallyBound.enabled && rolloutEnabled,
  };
}
