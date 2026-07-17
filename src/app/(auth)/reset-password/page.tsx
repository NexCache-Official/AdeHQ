"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthShell, AuthStatusChip } from "@/components/AuthShell";
import { PasswordStrengthField } from "@/components/auth/PasswordStrengthField";
import { Button } from "@/components/ui";
import { getPasswordStrength, passwordsMatch } from "@/lib/auth/password";
import { establishSessionFromUrl } from "@/lib/auth/callback-session";
import {
  captureRecoveryIntentFromUrl,
  clearPasswordRecoveryPending,
  markPasswordRecoveryPending,
} from "@/lib/auth/recovery";
import { authHeaders } from "@/lib/api/auth-client";
import { supabase } from "@/lib/supabase/client";
import { ArrowRight, KeyRound, Loader2, ShieldCheck } from "lucide-react";

function ResetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [sessionReady, setSessionReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const strength = getPasswordStrength(password);
  const match = passwordsMatch(password, confirm);

  useEffect(() => {
    let active = true;

    const verifySession = async () => {
      try {
        captureRecoveryIntentFromUrl();
        await establishSessionFromUrl();

        const { data, error: sessionError } = await supabase.auth.getSession();
        if (!active) return;

        if (sessionError || !data.session?.user) {
          setSessionReady(false);
          setError("This reset link is invalid or has expired. Request a new one.");
          return;
        }

        setSessionReady(true);
      } catch {
        if (!active) return;
        setSessionReady(false);
        setError("This reset link is invalid or has expired. Request a new one.");
      } finally {
        if (active) setChecking(false);
      }
    };

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" && session?.user) {
        markPasswordRecoveryPending();
        setSessionReady(true);
        setChecking(false);
        setError(null);
      }
    });

    void verifySession();

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const submit = async () => {
    setError(null);

    if (!strength.passed) {
      setError("Use a stronger password: 8+ characters, a mix of character types, and no obvious patterns.");
      return;
    }
    if (!match) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionData.session?.user) {
        setSessionReady(false);
        setError("Your reset session expired. Request a new reset link.");
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;

      try {
        await fetch("/api/auth/password-changed-notify", {
          method: "POST",
          headers: await authHeaders(),
        });
      } catch {
        // Non-blocking — password was updated successfully.
      }

      await supabase.auth.signOut();
      clearPasswordRecoveryPending();
      setDone(true);
      setTimeout(() => router.replace("/login?reset=1"), 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update password.");
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <AuthShell scene="reset">
        <AuthStatusChip label="Status · verifying link" tone="accent" />
        <div className="flex items-center gap-2 text-sm text-ink-2">
          <Loader2 className="h-4 w-4 animate-spin text-accent" />
          Verifying your reset link…
        </div>
      </AuthShell>
    );
  }

  if (!sessionReady && !done) {
    return (
      <AuthShell scene="trouble">
        <AuthStatusChip label="Status · link clocked out" />
        <div className="mb-5 flex h-[72px] w-[72px] items-center justify-center rounded-[22px] bg-rose-50 text-rose-600 ring-1 ring-rose-200">
          <KeyRound className="h-8 w-8" strokeWidth={1.75} />
        </div>
        <h1 className="text-[27px] font-semibold leading-[1.15] tracking-[-0.03em] text-ink">
          Link expired
          <span className="text-accent">.</span>
        </h1>
        <p className="mt-2 text-[14.5px] leading-relaxed text-ink-2">
          {error ?? "This password reset link is no longer valid."}
        </p>
        <Link
          href="/forgot-password"
          className="mt-7 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-accent px-5 text-sm font-semibold text-white transition hover:bg-accent-d"
        >
          Request a new reset link
          <ArrowRight className="h-4 w-4" />
        </Link>
      </AuthShell>
    );
  }

  if (done) {
    return (
      <AuthShell scene="reset">
        <AuthStatusChip label="Status · password updated" tone="green" />
        <div className="mb-5 flex h-[72px] w-[72px] items-center justify-center rounded-[22px] bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
          <ShieldCheck className="h-8 w-8" strokeWidth={1.75} />
        </div>
        <h1 className="text-[27px] font-semibold leading-[1.15] tracking-[-0.03em] text-ink">
          Password updated
          <span className="text-accent">.</span>
        </h1>
        <p className="mt-2 text-[14.5px] leading-relaxed text-ink-2">
          Your new password is set. Taking you back to sign in…
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell scene="reset">
      <AuthStatusChip label="Status · choose a new key" tone="accent" />
      <h1 className="text-[27px] font-semibold leading-[1.15] tracking-[-0.03em] text-ink">
        Choose a new password
        <span className="text-accent">.</span>
      </h1>
      <p className="mt-2 text-[14.5px] leading-relaxed text-ink-2">
        Pick something strong you haven&apos;t used elsewhere. You&apos;ll sign in again once this is
        saved.
      </p>

      <form
        className="mt-7 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <PasswordStrengthField label="New password" value={password} onChange={setPassword} autoFocus />
        <PasswordStrengthField
          label="Confirm new password"
          value={confirm}
          onChange={setConfirm}
          showStrength={false}
          placeholder="Re-enter your new password"
        />
        {confirm.length > 0 && (
          <p className={`text-xs ${match ? "text-emerald-700" : "text-rose-600"}`}>
            {match ? "Passwords match." : "Passwords do not match yet."}
          </p>
        )}
        <Button type="submit" size="lg" className="w-full" disabled={loading || !strength.passed || !match}>
          {loading ? "Saving…" : "Update password"} <ArrowRight className="h-4 w-4" />
        </Button>
      </form>

      {error && (
        <p className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
      )}
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center text-sm text-ink-3">Loading…</div>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
