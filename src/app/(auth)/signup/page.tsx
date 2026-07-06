"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthShell } from "@/components/AuthShell";
import { Button } from "@/components/ui";
import { useStore } from "@/lib/demo-store";
import { ResendConfirmation } from "@/components/auth/ResendConfirmation";
import { ENABLE_DEMO_MODE } from "@/lib/config/features";
import { ArrowRight, Sparkles } from "lucide-react";

export default function SignupPage() {
  const { actions, error: storeError } = useStore();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmationSent, setConfirmationSent] = useState(false);
  const [confirmationEmail, setConfirmationEmail] = useState("");
  const [repeatedSignup, setRepeatedSignup] = useState(false);
  const [signupsDisabled, setSignupsDisabled] = useState(false);

  useEffect(() => {
    actions.clearError();
  }, [actions]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/platform/status");
        if (!res.ok || cancelled) return;
        const body = await res.json();
        if (!body.signupsEnabled) setSignupsDisabled(true);
      } catch {
        // fail open
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const create = async () => {
    setError(null);
    actions.clearError();
    if (!email.trim() || !password) {
      setError("Enter an email and password to create a workspace.");
      return;
    }
    if (password.length < 6) {
      setError("Use a password with at least 6 characters.");
      return;
    }

    setLoading(true);
    try {
      const result = await actions.signup(
        { name: name || "Workspace Owner", email: email.trim() },
        workspace || "My AI Workspace",
        password,
      );
      if (result.needsEmailConfirmation) {
        setConfirmationEmail(email.trim());
        setRepeatedSignup(Boolean(result.repeatedSignup));
        setConfirmationSent(true);
        return;
      }
      router.replace("/onboarding");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create workspace.");
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
        Create your AI workforce.
      </h1>
      <p className="mt-1.5 text-sm text-slate-500">
        We&apos;ll save your workspace name for onboarding — nothing is created until you finish
        setup.
      </p>

      {signupsDisabled && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          New signups are temporarily disabled. Please check back later or contact support.
        </div>
      )}

      {confirmationSent ? (
        <div className="mt-7 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-left">
          <h2 className="text-sm font-semibold text-emerald-900">Check your email</h2>
          <p className="mt-2 text-sm text-emerald-800">
            {repeatedSignup ? (
              <>
                An account for <span className="font-medium">{confirmationEmail}</span> already exists.
                We sent a fresh confirmation link if your email was still unverified.
              </>
            ) : (
              <>
                We sent a confirmation link to{" "}
                <span className="font-medium">{confirmationEmail}</span>. Click it to activate your
                account and continue to onboarding.
              </>
            )}
          </p>
          <p className="mt-3 text-xs text-emerald-700">
            The email comes from Supabase (<span className="font-mono">noreply@mail.app.supabase.io</span>
            ). Check spam or promotions if you do not see it within a minute.
          </p>
          <p className="mt-2 text-xs text-emerald-700">
            The link returns you to{" "}
            <span className="font-medium">ade-hq-eight.vercel.app</span> at{" "}
            <span className="font-mono">/auth/callback</span>.
          </p>
          <Link
            href="/login"
            className="mt-4 inline-flex text-sm font-medium text-accent-600 hover:text-accent-700"
          >
            Already confirmed? Enter workspace →
          </Link>
          <div className="mt-5 border-t border-emerald-200 pt-4">
            <p className="mb-3 text-xs text-emerald-800">Link expired or didn&apos;t arrive?</p>
            <ResendConfirmation email={confirmationEmail} showEmailInput={false} />
          </div>
        </div>
      ) : (
      <>
      <form
        className="mt-7 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-slate-500">Name</span>
          <input
            className="input-field"
            placeholder="Shubham Kumar"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
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
        <div className="grid grid-cols-2 gap-3">
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
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-500">Workspace name (for later)</span>
            <input
              className="input-field"
              placeholder="Acme HQ"
              value={workspace}
              onChange={(e) => setWorkspace(e.target.value)}
            />
          </label>
        </div>
        <Button type="submit" size="lg" className="w-full" disabled={loading || signupsDisabled}>
          {loading ? "Creating..." : signupsDisabled ? "Signups disabled" : "Create account"}{" "}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </form>

      {(error || storeError) && (
        <p className="mt-3 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-700">
          {error ?? storeError}
        </p>
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
            Continue with demo workspace
          </Button>
        </>
      )}

      <p className="mt-6 text-center text-sm text-slate-500">
        Already have a workspace?{" "}
        <Link href="/login" className="font-medium text-accent-600 hover:text-accent-700">
          Enter workspace
        </Link>
      </p>
      </>
      )}
    </AuthShell>
  );
}
