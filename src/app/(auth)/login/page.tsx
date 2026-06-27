"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthShell } from "@/components/AuthShell";
import { ResendConfirmation } from "@/components/auth/ResendConfirmation";
import { Button } from "@/components/ui";
import { useStore } from "@/lib/demo-store";
import { parseAuthError } from "@/lib/auth/confirmation";
import { ENABLE_DEMO_MODE } from "@/lib/config/features";
import { supabase } from "@/lib/supabase/client";
import { ArrowRight, Sparkles } from "lucide-react";

function LoginForm() {
  const { state, actions, error: storeError, hydrated } = useStore();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState(state.user?.email ?? "");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [showResend, setShowResend] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    actions.clearError();
  }, [actions]);

  useEffect(() => {
    if (searchParams.get("confirmed") === "1") {
      setInfo("Your email is already confirmed. Sign in with your password below.");
      setShowResend(false);
      setNeedsConfirmation(false);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!hydrated) return;
    if (state.user) {
      router.replace(state.onboardingComplete ? "/" : "/onboarding");
      return;
    }
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user) {
        router.replace("/onboarding");
      }
    });
  }, [hydrated, state.user, state.onboardingComplete, router]);

  const enter = async () => {
    setError(null);
    actions.clearError();
    setNeedsConfirmation(false);
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }

    setLoading(true);
    try {
      await actions.login(email.trim(), password);
      router.replace("/");
    } catch (err) {
      const parsed = parseAuthError(err);
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
    <AuthShell>
      <div className="mb-8 lg:hidden">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-accent-500 to-glow-amber">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <span className="text-lg font-semibold text-slate-900">AdeHQ</span>
        </div>
      </div>

      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
        Welcome back to AdeHQ.
      </h1>
      <p className="mt-1.5 text-sm text-slate-500">
        Your AI employees are ready to work.
      </p>

      <form
        className="mt-7 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          enter();
        }}
      >
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-slate-500">Email</span>
          <input
            type="email"
            className="input-field"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-slate-500">Password</span>
          <input
            type="password"
            className="input-field"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <Button type="submit" size="lg" className="w-full">
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

      <p className="mt-6 text-center text-sm text-slate-500">
        New here?{" "}
        <Link href="/signup" className="font-medium text-accent-600 hover:text-accent-700">
          Create your AI workforce
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
