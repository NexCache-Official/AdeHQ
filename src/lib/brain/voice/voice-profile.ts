import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmployeeVoiceProfile } from "./types";
import {
  pickGenderedVoice,
  resolveVoiceGender,
  voiceMatchesGender,
  type VoiceGender,
  type VoiceGenderMode,
  XAI_FEMALE_VOICES,
  XAI_MALE_VOICES,
} from "./voice-gender";

const XAI_BUILT_IN_VOICES = ["eve", "ara", "leo", "rex", "sal"] as const;

function deterministicVoice(employeeId: string): string {
  const digest = createHash("sha256").update(employeeId).digest();
  return XAI_BUILT_IN_VOICES[digest[0]! % XAI_BUILT_IN_VOICES.length]!;
}

function genderFromXaiVoice(voiceId: string): VoiceGender {
  const id = voiceId.trim().toLowerCase();
  if ((XAI_FEMALE_VOICES as readonly string[]).includes(id)) return "female";
  if ((XAI_MALE_VOICES as readonly string[]).includes(id)) return "male";
  return "female";
}

function normalizeGenderMode(raw: unknown): VoiceGenderMode {
  if (raw === "female" || raw === "male" || raw === "auto") return raw;
  return "auto";
}

export function normalizeEmployeeVoiceProfile(
  employeeId: string,
  raw: unknown,
  options?: { employeeName?: string | null; realignGender?: boolean },
): EmployeeVoiceProfile {
  const value =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const legacyStyle =
    typeof value.voiceStyle === "string" ? value.voiceStyle : "professional";
  const tone =
    typeof value.tone === "string" ? value.tone : legacyStyle;
  const allowedTones = new Set([
    "professional",
    "warm",
    "energetic",
    "calm",
    "direct",
    "thoughtful",
  ]);
  const routePreference =
    typeof value.routePreference === "string" ? value.routePreference : "auto";
  const allowedRoutes = new Set(["auto", "standard", "premium", "local"]);
  const pace = Number(value.pace ?? value.speakingRate ?? 1);
  const genderMode = normalizeGenderMode(value.genderMode);
  const hasName = Boolean(options?.employeeName?.trim());
  const inferredGender = resolveVoiceGender({
    genderMode,
    employeeName: options?.employeeName,
  });

  const bindings = Array.isArray(value.providerBindings)
    ? value.providerBindings
        .filter((binding): binding is Record<string, unknown> =>
          Boolean(binding && typeof binding === "object"),
        )
        .map((binding) => ({
          provider: String(binding.provider ?? ""),
          voiceId: String(binding.voiceId ?? ""),
          qualityTier: String(binding.qualityTier ?? "standard") as
            | "standard"
            | "premium"
            | "local",
        }))
        .filter((binding) => binding.provider && binding.voiceId)
    : [];

  const existingXai = bindings.find(
    (binding) => binding.provider === "xai" && binding.qualityTier === "standard",
  )?.voiceId;

  // With a real employee name (or explicit gender), keep voice in that gender
  // pool. Without a name, preserve legacy hash across all five xAI voices.
  let finalXaiVoice: string;
  let resolvedGender: VoiceGender = inferredGender;

  if (!hasName && genderMode === "auto" && !options?.realignGender) {
    finalXaiVoice = existingXai || deterministicVoice(employeeId);
    resolvedGender = genderFromXaiVoice(finalXaiVoice);
  } else {
    const mismatch =
      Boolean(existingXai) &&
      !voiceMatchesGender(existingXai!, inferredGender, "xai");
    const shouldRealign =
      Boolean(options?.realignGender) ||
      !existingXai ||
      mismatch ||
      bindings.length === 0;
    finalXaiVoice = shouldRealign
      ? pickGenderedVoice({
          employeeId,
          gender: inferredGender,
          provider: "xai",
          preferredVoiceId: mismatch ? null : existingXai,
        })
      : existingXai!;
    resolvedGender = inferredGender;
  }

  const cosyVoice = pickGenderedVoice({
    employeeId,
    gender: resolvedGender,
    provider: "siliconflow",
  });

  const nextBindings = [
    ...bindings.filter(
      (binding) =>
        !(
          (binding.provider === "xai" && binding.qualityTier === "standard") ||
          (binding.provider === "siliconflow" &&
            binding.qualityTier === "standard")
        ),
    ),
    {
      provider: "xai",
      voiceId: finalXaiVoice,
      qualityTier: "standard" as const,
    },
    {
      provider: "siliconflow",
      voiceId: cosyVoice,
      qualityTier: "standard" as const,
    },
  ];

  return {
    voiceEnabled: value.voiceEnabled !== false,
    voiceIdentityKey:
      typeof value.voiceIdentityKey === "string" && value.voiceIdentityKey
        ? value.voiceIdentityKey
        : `employee-${employeeId}`,
    locale:
      typeof value.locale === "string" && value.locale ? value.locale : "en",
    accent: typeof value.accent === "string" ? value.accent : undefined,
    tone: (allowedTones.has(tone) ? tone : "professional") as EmployeeVoiceProfile["tone"],
    pace: Number.isFinite(pace) ? Math.min(1.5, Math.max(0.7, pace)) : 1,
    routePreference: (allowedRoutes.has(routePreference)
      ? routePreference
      : "auto") as EmployeeVoiceProfile["routePreference"],
    genderMode,
    resolvedGender,
    providerBindings: nextBindings,
    premiumVoiceAllowed: value.premiumVoiceAllowed === true,
    voiceStyle: allowedTones.has(legacyStyle)
      ? (legacyStyle as EmployeeVoiceProfile["voiceStyle"])
      : "professional",
    speakingRate: Number.isFinite(pace) ? pace : 1,
  };
}

export async function loadEmployeeVoiceProfile(
  client: SupabaseClient,
  workspaceId: string,
  employeeId: string,
): Promise<EmployeeVoiceProfile> {
  const { data, error } = await client
    .from("ai_employees")
    .select("voice_profile, name")
    .eq("workspace_id", workspaceId)
    .eq("id", employeeId)
    .maybeSingle();
  if (error) throw error;
  return normalizeEmployeeVoiceProfile(employeeId, data?.voice_profile, {
    employeeName: typeof data?.name === "string" ? data.name : null,
  });
}

export function resolveProviderVoice(
  profile: EmployeeVoiceProfile,
  provider: string,
  qualityTier: "standard" | "premium" | "local",
): string | undefined {
  return (
    profile.providerBindings.find(
      (binding) =>
        binding.provider === provider && binding.qualityTier === qualityTier,
    ) ??
    profile.providerBindings.find((binding) => binding.provider === provider)
  )?.voiceId;
}
