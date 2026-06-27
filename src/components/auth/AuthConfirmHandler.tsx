"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import {
  consumeAuthNextPath,
  establishSessionFromUrl,
  hasAuthParamsInUrl,
} from "@/lib/auth/callback-session";
import { loadWorkspaceState } from "@/lib/supabase/persistence";

/**
 * Catches email-confirmation tokens when Supabase redirects to the Site URL
 * (e.g. https://ade-hq-eight.vercel.app#access_token=...).
 */
export function AuthConfirmHandler() {
  const router = useRouter();
  const pathname = usePathname();
  const busyRef = useRef(false);

  useEffect(() => {
    if (busyRef.current) return;
    if (pathname === "/auth/callback") return;

    const search = typeof window !== "undefined" ? window.location.search : "";
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    const hasParams = hasAuthParamsInUrl() || search.includes("error=");

    if (!hasParams && !hash) return;

    busyRef.current = true;

    const run = async () => {
      try {
        const authError = new URLSearchParams(search).get("error_description");
        if (authError) {
          router.replace(`/auth/callback?error_description=${encodeURIComponent(authError)}`);
          return;
        }

        const established = await establishSessionFromUrl();
        const { data } = await supabase.auth.getSession();

        if (!established || !data.session?.user) {
          router.replace("/auth/callback?error=missing_session");
          return;
        }

        await loadWorkspaceState(data.session.user);
        router.replace(consumeAuthNextPath("/onboarding"));
      } catch {
        router.replace("/auth/callback?error=confirmation_failed");
      } finally {
        busyRef.current = false;
      }
    };

    void run();
  }, [pathname, router]);

  return null;
}
