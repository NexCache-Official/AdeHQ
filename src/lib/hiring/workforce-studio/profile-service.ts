import type { SupabaseClient } from "@supabase/supabase-js";
import { EMPTY_COMPANY_PROFILE, type CompanyOperatingProfile } from "./company-profile-types";

type ProfileRow = {
  workspace_id: string;
  revision: number;
  payload: Record<string, unknown>;
  updated_by: string | null;
  updated_at: string;
};

function rowToProfile(row: ProfileRow): CompanyOperatingProfile {
  return {
    workspaceId: row.workspace_id,
    revision: row.revision,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
    ...(EMPTY_COMPANY_PROFILE as Omit<CompanyOperatingProfile, "workspaceId" | "updatedAt" | "updatedBy" | "revision">),
    ...(row.payload as Partial<CompanyOperatingProfile>),
  };
}

export async function getCompanyOperatingProfile(
  client: SupabaseClient,
  workspaceId: string,
): Promise<CompanyOperatingProfile | null> {
  const { data, error } = await client
    .from("company_operating_profiles")
    .select("workspace_id, revision, payload, updated_by, updated_at")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return rowToProfile(data as ProfileRow);
}

export async function upsertCompanyOperatingProfile(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    updatedBy: string;
    profile: Omit<CompanyOperatingProfile, "workspaceId" | "revision" | "updatedBy" | "updatedAt">;
  },
): Promise<CompanyOperatingProfile> {
  const existing = await getCompanyOperatingProfile(client, params.workspaceId);
  const nextRevision = (existing?.revision ?? 0) + 1;
  const payload = { ...params.profile };

  const { data, error } = await client
    .from("company_operating_profiles")
    .upsert(
      {
        workspace_id: params.workspaceId,
        revision: nextRevision,
        payload,
        updated_by: params.updatedBy,
      },
      { onConflict: "workspace_id" },
    )
    .select("workspace_id, revision, payload, updated_by, updated_at")
    .single();
  if (error) throw error;

  await client.from("company_operating_profile_revisions").insert({
    workspace_id: params.workspaceId,
    revision: nextRevision,
    payload,
    updated_by: params.updatedBy,
  });

  return rowToProfile(data as ProfileRow);
}
