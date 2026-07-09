"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { completeAuthRedirect, hasAuthParamsInUrl } from "@/lib/auth/callback-session";
import { parseAuthError } from "@/lib/auth/confirmation";
import { loadWorkspaceState } from "@/lib/supabase/persistence";

/**
 * Handles email-confirmation tokens when Supabase redirects to the site root or another page.
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

        const result = await completeAuthRedirect();
        if (!result.ok) {
          const parsed = parseAuthError(result.error);
          if (parsed.needsEmailConfirmation) {
            router.replace("/confirm-email");
            return;
          }
          const recoveryNext = new URLSearchParams(search).get("next") === "/reset-password";
          if (recoveryNext || parsed.linkExpired) {
            router.replace("/reset-password");
            return;
          }
          if (result.linkError || parsed.alreadyConfirmedHint) {
            router.replace("/login?confirmed=1");
            return;
          }
          router.replace("/auth/callback?error=confirmation_failed");
          return;
        }

        const { data: userData } = await supabase.auth.getUser();
        if (userData.user && result.next !== "/reset-password") {
          await loadWorkspaceState(userData.user);
        }
        router.replace(result.next);
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
