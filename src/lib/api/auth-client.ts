import { supabase } from "@/lib/supabase/client";

export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function authHeaders(): Promise<HeadersInit> {
  const token = await getAccessToken();
  if (!token) throw new Error("Not signed in.");
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}
