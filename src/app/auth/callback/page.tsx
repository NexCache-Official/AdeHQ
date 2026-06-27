"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import {
  consumeAuthNextPath,
  establishSessionFromUrl,
} from "@/lib/auth/callback-session";
import { parseAuthError } from "@/lib/auth/confirmation";
import { ResendConfirmation } from "@/components/auth/ResendConfirmation";
import { loadWorkspaceState } from "@/lib/supabase/persistence";
import { getSiteUrl } from "@/lib/site-url";
import { Sparkles } from "lucide-react";

function AuthCallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [message, setMessage] = useState("Confirming your email…");
  const [failed, setFailed] = useState(false);
  const [needsResend, setNeedsResend] = useState(false);
  const [emailHint, setEmailHint] = useState("");

  useEffect(() => {
    let active = true;

    const finish = async () => {
      const authError =
        searchParams.get("error_description") ??
        searchParams.get("error") ??
        (searchParams.get("error") === "missing_session"
          ? "No session tokens arrived. Request a new confirmation email."
          : null);

      if (authError && authError !== "confirmation_failed") {
        if (!active) return;
        const parsed = parseAuthError({ message: decodeURIComponent(authError) });
        setFailed(true);
        setNeedsResend(true);
        setMessage(parsed.message);
        return;
      }

      try {
        const established = await establishSessionFromUrl();

        if (!established) {
          // Give detectSessionInUrl extra time (slow mobile networks).
          await new Promise((r) => setTimeout(r, 1200));
        }

        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;

        if (!data.session?.user) {
          throw new Error(
            "No login session was created. Your Supabase redirect URL may not be configured — request a new confirmation email after deploying the latest version.",
          );
        }

        setEmailHint(data.session.user.email ?? "");

        await loadWorkspaceState(data.session.user);

        if (!active) return;

        const next = searchParams.get("next") ?? consumeAuthNextPath("/onboarding");
        const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/onboarding";
        router.replace(safeNext);
      } catch (err) {
        if (!active) return;
        const parsed = parseAuthError(err);
        setFailed(true);
        setNeedsResend(true);
        setMessage(parsed.message);
      }
    };

    void finish();

    return () => {
      active = false;
    };
  }, [router, searchParams]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-500 to-glow-amber shadow-glow-sm">
        <Sparkles className="h-6 w-6 text-white" />
      </div>
      <p className={`mt-6 max-w-md text-center text-sm ${failed ? "text-rose-700" : "text-slate-600"}`}>
        {message}
      </p>

      {failed && (
        <div className="mt-4 max-w-md rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-left text-xs text-amber-900">
          <p className="font-semibold">Supabase redirect setup</p>
          <p className="mt-1">
            In Supabase → Authentication → URL Configuration, set Site URL to{" "}
            <span className="font-mono">{getSiteUrl()}</span> and add Redirect URL{" "}
            <span className="font-mono">{getSiteUrl()}/**</span> (optional but recommended).
          </p>
        </div>
      )}

      {failed && needsResend && (
        <div className="mt-6 w-full max-w-sm">
          <ResendConfirmation email={emailHint} />
        </div>
      )}

      {failed && (
        <div className="mt-6 flex flex-col items-center gap-2 text-sm">
          <Link href="/login" className="font-medium text-accent-600 hover:text-accent-700">
            Back to login
          </Link>
          <Link href="/signup" className="text-slate-500 hover:text-slate-700">
            Create a new account
          </Link>
        </div>
      )}
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">
          Confirming your email…
        </div>
      }
    >
      <AuthCallbackInner />
    </Suspense>
  );
}
