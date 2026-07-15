import { getActiveWorkspaceId } from "@/lib/active-workspace";
import { supabase } from "@/lib/supabase/client";

/** Sent on every authenticated client request so shared room ids (e.g. Maya DM) resolve to the active HQ. */
export const WORKSPACE_ID_HEADER = "x-adehq-workspace-id";

export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function authHeaders(workspaceId?: string | null): Promise<HeadersInit> {
  const token = await getAccessToken();
  if (!token) throw new Error("Not signed in.");
  const activeWorkspaceId = workspaceId ?? getActiveWorkspaceId();
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    ...(activeWorkspaceId ? { [WORKSPACE_ID_HEADER]: activeWorkspaceId } : {}),
  };
}
