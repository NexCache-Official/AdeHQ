import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmployeeVoiceProfile } from "./types";

const XAI_BUILT_IN_VOICES = ["eve", "ara", "leo", "rex", "sal"] as const;

function deterministicVoice(employeeId: string): string {
  const digest = createHash("sha256").update(employeeId).digest();
  return XAI_BUILT_IN_VOICES[digest[0] % XAI_BUILT_IN_VOICES.length];
}

export function normalizeEmployeeVoiceProfile(
  employeeId: string,
  raw: unknown,
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
    providerBindings:
      bindings.length > 0
        ? bindings
        : [
            {
              provider: "xai",
              voiceId: deterministicVoice(employeeId),
              qualityTier: "standard",
            },
          ],
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
    .select("voice_profile")
    .eq("workspace_id", workspaceId)
    .eq("id", employeeId)
    .maybeSingle();
  if (error) throw error;
  return normalizeEmployeeVoiceProfile(employeeId, data?.voice_profile);
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

