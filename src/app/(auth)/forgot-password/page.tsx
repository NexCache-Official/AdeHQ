"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { AuthShell, AuthStatusChip } from "@/components/AuthShell";
import { Button } from "@/components/ui";
import { requestPasswordReset } from "@/lib/auth/recovery";
import { ArrowLeft, ArrowRight, Mail } from "lucide-react";

function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    setError(null);
    setLoading(true);
    try {
      await requestPasswordReset(email);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to send reset email.");
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <AuthShell scene="reset">
        <AuthStatusChip label="Status · reset link dispatched" tone="green" />
        <div className="mb-5 flex h-[72px] w-[72px] items-center justify-center rounded-[22px] bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
          <Mail className="h-8 w-8" strokeWidth={1.75} />
        </div>
        <h1 className="text-[27px] font-semibold leading-[1.15] tracking-[-0.03em] text-ink">
          Check your inbox
          <span className="text-accent">.</span>
        </h1>
        <p className="mt-2 text-[14.5px] leading-relaxed text-ink-2">
          If an account exists for <span className="font-semibold text-ink">{email.trim()}</span>, we
          sent a password reset link. It clocks out in 20 minutes.
        </p>
        <p className="mt-4 rounded-[18px] border border-border bg-surface px-4 py-3 text-sm leading-relaxed text-ink-2">
          Open the email and click <span className="font-semibold text-ink">Reset password</span> —
          then sign in with your new credentials like nothing happened.
        </p>
        <Link
          href="/login"
          className="mt-7 inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-border bg-surface px-5 text-sm font-semibold text-ink transition hover:border-ink/25"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to sign in
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell scene="reset">
      <AuthStatusChip label="Status · key exchange" />
      <h1 className="text-[27px] font-semibold leading-[1.15] tracking-[-0.03em] text-ink">
        Reset your password
        <span className="text-accent">.</span>
      </h1>
      <p className="mt-2 text-[14.5px] leading-relaxed text-ink-2">
        Enter the email on your AdeHQ account — we&apos;ll send a secure link so you can choose a new
        one.
      </p>

      <form
        className="mt-7 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold text-ink-3">Email</span>
          <input
            type="email"
            className="input-field"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
        </label>
        <Button type="submit" size="lg" className="w-full" disabled={loading}>
          {loading ? "Sending link…" : "Send reset link"} <ArrowRight className="h-4 w-4" />
        </Button>
      </form>

      {error && (
        <p className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
      )}

      <Link
        href="/login"
        className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-ink-3 hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to sign in
      </Link>
    </AuthShell>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center text-sm text-ink-3">Loading…</div>
      }
    >
      <ForgotPasswordForm />
    </Suspense>
  );
}
