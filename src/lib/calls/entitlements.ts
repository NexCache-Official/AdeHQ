import type { SupabaseClient } from "@supabase/supabase-js";
import type { HumanCallEntitlements } from "./types";

const DEFAULTS: Record<string, HumanCallEntitlements> = {
  free: {
    enabled: true,
    maxConcurrentCallsPerWorkspace: 2,
    maxParticipants: 2,
    audioEnabled: true,
    videoEnabled: false,
    screenShareEnabled: false,
    groupCallsEnabled: false,
    recordingEnabled: false,
    forceRelayAvailable: false,
    maxVideoQuality: "360p",
  },
  pro: {
    enabled: true,
    maxConcurrentCallsPerWorkspace: 10,
    maxParticipants: 8,
    audioEnabled: true,
    videoEnabled: true,
    screenShareEnabled: true,
    groupCallsEnabled: true,
    recordingEnabled: false,
    forceRelayAvailable: false,
    maxVideoQuality: "720p",
  },
  team: {
    enabled: true,
    maxConcurrentCallsPerWorkspace: 25,
    maxParticipants: 25,
    audioEnabled: true,
    videoEnabled: true,
    screenShareEnabled: true,
    groupCallsEnabled: true,
    recordingEnabled: true,
    forceRelayAvailable: true,
    maxVideoQuality: "1080p",
  },
};

export async function resolveHumanCallEntitlements(
  client: SupabaseClient,
  workspaceId: string,
): Promise<HumanCallEntitlements> {
  if (process.env.ADEHQ_HUMAN_CALLS_V1 === "0") {
    return { ...DEFAULTS.free, enabled: false };
  }
  const { data, error } = await client
    .from("workspaces")
    .select("plan_slug, plan")
    .eq("id", workspaceId)
    .maybeSingle();
  if (error) throw error;
  const slug = String(data?.plan_slug ?? data?.plan ?? "free").toLowerCase();
  if (/(business|enterprise|team)/.test(slug)) return DEFAULTS.team;
  if (/(pro|plus)/.test(slug)) return DEFAULTS.pro;
  return DEFAULTS.free;
}
