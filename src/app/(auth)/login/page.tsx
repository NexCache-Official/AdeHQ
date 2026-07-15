"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthModeTabs, AuthShell } from "@/components/AuthShell";
import { ResendConfirmation } from "@/components/auth/ResendConfirmation";
import { Button } from "@/components/ui";
import { useStore } from "@/lib/demo-store";
import { parseAuthError } from "@/lib/auth/confirmation";
import { isPasswordRecoveryPending } from "@/lib/auth/recovery";
import { safeAuthNextPath } from "@/lib/auth/safe-next";
import { ENABLE_DEMO_MODE } from "@/lib/config/features";
import { supabase } from "@/lib/supabase/client";
import { ArrowRight, Eye, EyeOff, Sparkles } from "lucide-react";

function LoginForm() {
  const { actions, error: storeError } = useStore();
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [showResend, setShowResend] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    actions.clearError();
    if (!isPasswordRecoveryPending()) {
      void supabase.auth.signOut();
    }
  }, [actions]);

  useEffect(() => {
    if (searchParams.get("confirmed") === "1") {
      setInfo("Your email is already confirmed. Sign in with your password below.");
      setShowResend(false);
      setNeedsConfirmation(false);
    }
    if (searchParams.get("reset") === "1") {
      setInfo("Your password was updated. Sign in with your new password.");
      setShowResend(false);
      setNeedsConfirmation(false);
    }
  }, [searchParams]);

  const enter = async () => {
    setError(null);
    actions.clearError();
    setNeedsConfirmation(false);
    setInfo(null);
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }

    setLoading(true);
    try {
      const { onboardingComplete } = await actions.login(email.trim(), password);
      const destination = nextPath
        ? safeAuthNextPath(nextPath, onboardingComplete ? "/" : "/onboarding")
        : onboardingComplete
          ? "/"
          : "/onboarding";
      router.replace(destination);
    } catch (err) {
      const parsed = parseAuthError(err);
      if (parsed.needsEmailConfirmation) {
        // Unverified accounts belong on the dedicated verification page, not
        // stuck on the login form.
        router.replace(`/confirm-email?email=${encodeURIComponent(email.trim())}`);
        return;
      }
      setError(parsed.message);
      setNeedsConfirmation(parsed.needsEmailConfirmation);
      setShowResend(parsed.needsEmailConfirmation);
      if (parsed.alreadyConfirmedHint) {
        setInfo("Your email is already confirmed. Sign in with your password.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell scene="signin">
      <AuthModeTabs mode="signin" nextPath={nextPath} />
      <h1 className="mb-2 text-[27px] font-semibold leading-[1.15] tracking-[-0.03em] text-[#111113]">
        Welcome back.
      </h1>
      <p className="mb-7 text-[14.5px] leading-relaxed text-[#111113]/55">
        Sign in to see what your <span className="font-serif italic">AI workforce</span> got done.
      </p>

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          enter();
        }}
      >
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold text-slate-500">Email</span>
          <input
            type="email"
            className="input-field"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="block space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-500">Password</span>
            <Link href="/forgot-password" className="text-xs font-medium text-accent-600 hover:text-accent-700">
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              className="input-field pr-11"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              onClick={() => setShowPassword((value) => !value)}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </label>
        <Button type="submit" size="lg" className="w-full" disabled={loading}>
          {loading ? "Entering..." : "Enter workspace"} <ArrowRight className="h-4 w-4" />
        </Button>
      </form>

      {info && (
        <p className="mt-3 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800">
          {info}
        </p>
      )}

      {(error || storeError) && (
        <p className={`mt-3 rounded-lg px-3 py-2 text-sm ${needsConfirmation ? "bg-amber-500/10 text-amber-900" : "bg-rose-500/10 text-rose-700"}`}>
          {error ?? storeError}
        </p>
      )}

      {(needsConfirmation || showResend) && !error?.toLowerCase().includes("incorrect email") && !error?.toLowerCase().includes("invalid api key") && (
        <div className="mt-4">
          <ResendConfirmation email={email} showEmailInput={false} />
        </div>
      )}

      {!showResend && !needsConfirmation && (
        <button
          type="button"
          className="mt-4 w-full text-center text-xs text-slate-500 hover:text-slate-700"
          onClick={() => setShowResend(true)}
        >
          Didn&apos;t get your confirmation email?
        </button>
      )}

      {ENABLE_DEMO_MODE && (
        <>
          <div className="my-5 flex items-center gap-3 text-xs text-slate-600">
            <span className="h-px flex-1 bg-slate-100" />
            or
            <span className="h-px flex-1 bg-slate-100" />
          </div>

          <Button
            variant="secondary"
            size="lg"
            className="w-full"
            onClick={() => {
              actions.loginDemo();
              router.replace("/");
            }}
          >
            <Sparkles className="h-4 w-4" />
            Continue as Demo Founder
          </Button>
        </>
      )}

      <p className="mt-[26px] text-center text-[13.5px] text-[#111113]/55">
        New to AdeHQ?{" "}
        <Link
          href={nextPath ? `/signup?next=${encodeURIComponent(nextPath)}` : "/signup"}
          className="font-semibold text-[#111113] hover:underline"
        >
          Create a workspace
        </Link>
      </p>
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-slate-500">Loading…</div>}>
      <LoginForm />
    </Suspense>
  );
}
