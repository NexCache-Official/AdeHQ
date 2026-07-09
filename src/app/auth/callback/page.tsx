"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { completeAuthRedirect } from "@/lib/auth/callback-session";
import { parseAuthError } from "@/lib/auth/confirmation";
import { ResendConfirmation } from "@/components/auth/ResendConfirmation";
import { loadWorkspaceState } from "@/lib/supabase/persistence";
import { getSiteUrl } from "@/lib/site-url";
import { BrandMark } from "@/components/brand/Brand";

function AuthCallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [message, setMessage] = useState("Confirming your email…");
  const [failed, setFailed] = useState(false);
  const [needsResend, setNeedsResend] = useState(false);
  const [alreadyConfirmed, setAlreadyConfirmed] = useState(false);
  const [emailHint, setEmailHint] = useState("");

  useEffect(() => {
    let active = true;

    const finish = async () => {
      const errorCode = searchParams.get("error");
      const authError =
        searchParams.get("error_description") ??
        (errorCode === "missing_session"
          ? "No session tokens arrived. Request a new confirmation email."
          : errorCode === "link_used"
            ? "Email link already used"
            : null);

      if (authError && errorCode !== "confirmation_failed") {
        if (!active) return;
        const parsed = parseAuthError({ message: decodeURIComponent(authError) });
        setFailed(true);
        setNeedsResend(parsed.needsEmailConfirmation);
        setAlreadyConfirmed(parsed.alreadyConfirmedHint || errorCode === "link_used");
        setMessage(parsed.message);
        return;
      }

      try {
        const result = await completeAuthRedirect(searchParams.get("next") ?? undefined);

        if (!result.ok) {
          const parsed = parseAuthError(result.error);
          if (!active) return;
          if (parsed.needsEmailConfirmation) {
            router.replace("/confirm-email");
            return;
          }
          const recoveryNext = searchParams.get("next") === "/reset-password";
          if (recoveryNext || parsed.linkExpired) {
            router.replace("/reset-password");
            return;
          }
          setFailed(true);
          setNeedsResend(parsed.needsEmailConfirmation);
          setAlreadyConfirmed(parsed.alreadyConfirmedHint || result.linkError);
          setMessage(parsed.message);
          return;
        }

        setEmailHint(result.email);

        if (result.next === "/reset-password") {
          if (!active) return;
          router.replace("/reset-password");
          return;
        }

        const { data: userData } = await supabase.auth.getUser();
        if (userData.user) {
          await loadWorkspaceState(userData.user);
        }

        if (!active) return;
        router.replace(result.next);
      } catch (err) {
        if (!active) return;
        const parsed = parseAuthError(err);
        setFailed(true);
        setNeedsResend(parsed.needsEmailConfirmation);
        setAlreadyConfirmed(parsed.alreadyConfirmedHint);
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
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-500 to-glow-amber shadow-glow-sm text-white">
        <BrandMark size={28} />
      </div>
      <p className={`mt-6 max-w-md text-center text-sm ${failed ? "text-rose-700" : "text-slate-600"}`}>
        {message}
      </p>

      {failed && !alreadyConfirmed && (
        <div className="mt-4 max-w-md rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-left text-xs text-amber-900">
          <p className="font-semibold">Supabase redirect setup</p>
          <p className="mt-1">
            In Supabase → Authentication → URL Configuration, set Site URL to{" "}
            <span className="font-mono">{getSiteUrl()}</span> and add Redirect URL{" "}
            <span className="font-mono">{getSiteUrl()}/**</span>
          </p>
        </div>
      )}

      {failed && needsResend && !alreadyConfirmed && (
        <div className="mt-6 w-full max-w-sm">
          <ResendConfirmation email={emailHint} />
        </div>
      )}

      {failed && (
        <div className="mt-6 flex flex-col items-center gap-2 text-sm">
          <Link href="/login?confirmed=1" className="font-medium text-accent-600 hover:text-accent-700">
            {alreadyConfirmed ? "Sign in to your workspace" : "Back to login"}
          </Link>
          {!alreadyConfirmed && (
            <Link href="/signup" className="text-slate-500 hover:text-slate-700">
              Create a new account
            </Link>
          )}
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
