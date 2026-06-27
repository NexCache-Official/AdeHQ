import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { SUPABASE_PROJECT_URL, SUPABASE_PUBLISHABLE_KEY } from "./config";

export function createAuthedClient(accessToken: string): SupabaseClient {
  return createClient(SUPABASE_PROJECT_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

export function getBearerToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}

export async function requireAuthUser(request: NextRequest): Promise<{
  user: User;
  client: SupabaseClient;
  accessToken: string;
}> {
  const accessToken = getBearerToken(request);
  if (!accessToken) {
    throw new AuthError("Missing authorization token.", 401);
  }

  const client = createAuthedClient(accessToken);
  const { data, error } = await client.auth.getUser(accessToken);
  if (error || !data.user) {
    throw new AuthError("Invalid or expired session.", 401);
  }

  return { user: data.user, client, accessToken };
}

export async function requireWorkspaceMembership(
  client: SupabaseClient,
  workspaceId: string,
  userId: string,
): Promise<{ role: string }> {
  const { data, error } = await client
    .from("workspace_members")
    .select("role, status")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data || data.status === "removed") {
    throw new AuthError("You are not a member of this workspace.", 403);
  }

  return { role: data.role };
}

export class AuthError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}
