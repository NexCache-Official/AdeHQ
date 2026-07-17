"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { completeAuthRedirect } from "@/lib/auth/callback-session";
import { parseAuthError } from "@/lib/auth/confirmation";
import { isPasswordRecoveryPending } from "@/lib/auth/recovery";
import { ResendConfirmation } from "@/components/auth/ResendConfirmation";
import { AuthShell } from "@/components/AuthShell";
import { BrandMark } from "@/components/brand/Brand";
import { loadWorkspaceState } from "@/lib/supabase/persistence";
import { getSiteUrl } from "@/lib/site-url";

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
          if (isPasswordRecoveryPending() || parsed.linkExpired) {
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

        if (isPasswordRecoveryPending()) {
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

  if (!failed) {
    return (
      <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-canvas px-6">
        <div
          aria-hidden
          className="pointer-events-none absolute -left-24 -top-32 h-80 w-80 rounded-full bg-[radial-gradient(circle,rgb(var(--c-accent)/0.2),transparent_68%)] blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-28 -right-20 h-96 w-96 rounded-full bg-[radial-gradient(circle,rgb(var(--c-accent-2)/0.16),transparent_70%)] blur-3xl"
        />
        <div className="relative flex flex-col items-center animate-[lgFadeUp_0.45s_cubic-bezier(0.2,0.7,0.3,1)_both]">
          <div className="relative mb-6">
            <span className="absolute inset-0 animate-ping rounded-[22px] bg-accent/15" />
            <div className="relative flex h-[72px] w-[72px] items-center justify-center rounded-[22px] bg-surface shadow-[0_18px_40px_-18px_rgba(47,111,237,0.55)] ring-1 ring-border">
              <BrandMark size={36} nativeColor />
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-ink-2">
            <Loader2 className="h-4 w-4 animate-spin text-accent" />
            {message}
          </div>
        </div>
      </div>
    );
  }

  const title = alreadyConfirmed
    ? "You’re already confirmed."
    : "That confirmation link didn’t stick.";

  const friendly =
    alreadyConfirmed
      ? "Your account is ready — sign in and we’ll take you into the workspace."
      : message.toLowerCase().includes("site url") || message.toLowerCase().includes("redirect")
        ? "We couldn’t create a login session from that email link. Usually the link expired, was already used, or the redirect URL doesn’t match this app origin."
        : message;

  return (
    <AuthShell scene="trouble">
      <div className="mb-6 flex h-[72px] w-[72px] items-center justify-center rounded-[22px] bg-amber-50 text-amber-700 ring-1 ring-amber-200">
        <AlertTriangle className="h-8 w-8" strokeWidth={1.75} />
      </div>
      <h1 className="mb-2 text-[27px] font-semibold leading-[1.15] tracking-[-0.03em] text-[#111113]">
        {title}
      </h1>
      <p className="text-[14.5px] leading-relaxed text-[#111113]/55">{friendly}</p>

      {!alreadyConfirmed && (
        <div className="mt-6 rounded-[18px] border border-amber-200 bg-amber-50 px-4 py-3.5 text-left text-xs leading-relaxed text-amber-950">
          <p className="font-semibold text-amber-900">Redirect checklist</p>
          <p className="mt-1.5 text-amber-900/85">
            In Supabase → Authentication → URL Configuration, set Site URL to{" "}
            <span className="font-mono">{getSiteUrl()}</span> and allow{" "}
            <span className="font-mono">{getSiteUrl()}/**</span>. Then request a fresh confirmation
            email.
          </p>
        </div>
      )}

      {needsResend && !alreadyConfirmed && (
        <div className="mt-6">
          <ResendConfirmation email={emailHint} />
        </div>
      )}

      <div className="mt-8 flex flex-col gap-3">
        <Link
          href="/login?confirmed=1"
          className="inline-flex h-11 items-center justify-center rounded-xl bg-accent px-5 text-sm font-semibold text-white transition hover:bg-accent-d"
        >
          {alreadyConfirmed ? "Sign in to your workspace" : "Back to login"}
        </Link>
        {!alreadyConfirmed && (
          <Link
            href="/signup"
            className="inline-flex h-11 items-center justify-center rounded-xl border border-border bg-surface px-5 text-sm font-semibold text-ink transition hover:border-ink/25"
          >
            Create a new account
          </Link>
        )}
      </div>
    </AuthShell>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-canvas text-sm text-ink-2">
          <Loader2 className="h-5 w-5 animate-spin text-accent" />
          Confirming your email…
        </div>
      }
    >
      <AuthCallbackInner />
    </Suspense>
  );
}
