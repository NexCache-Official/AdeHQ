"use client";

import { createClient } from "@supabase/supabase-js";
import { SUPABASE_PROJECT_URL, SUPABASE_PUBLISHABLE_KEY } from "./config";

// Postgrest-js issues plain GET requests with no explicit Cache-Control, which
// the browser (and this dev sandbox's proxy) can silently cache by URL — new
// rows then never show up until a hard reload. Force every Supabase request
// to bypass HTTP caching so workspace state always reflects the latest write.
function uncachedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, { ...init, cache: "no-store" });
}

export const supabase = createClient(
  SUPABASE_PROJECT_URL,
  SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      autoRefreshToken: true,
      // Handled explicitly in AuthConfirmHandler + /auth/callback (avoids double token consumption).
      detectSessionInUrl: false,
      persistSession: true,
    },
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
    global: {
      fetch: uncachedFetch,
    },
  },
);
