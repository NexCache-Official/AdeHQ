"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { AuthShell } from "@/components/AuthShell";
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
      <AuthShell>
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600">
          <Mail className="h-6 w-6" />
        </div>
        <h1 className="mt-5 text-[30px] font-semibold leading-tight tracking-[-0.03em] text-slate-950">
          Check your inbox.
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-slate-500">
          If an account exists for <span className="font-medium text-slate-700">{email.trim()}</span>, we sent a
          password reset link. It expires in 20 minutes.
        </p>
        <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-relaxed text-slate-600">
          Open the email and click <span className="font-medium text-slate-800">Reset password</span> to choose a
          new one, then sign in with your updated credentials.
        </p>
        <Link
          href="/login"
          className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-accent-600 hover:text-accent-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to sign in
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.03em] text-slate-950">
        Reset your password.
      </h1>
      <p className="mt-2 text-[15px] leading-relaxed text-slate-500">
        Enter the email on your AdeHQ account and we&apos;ll send a secure link to choose a new password.
      </p>

      <form
        className="mt-7 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
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
            autoFocus
          />
        </label>
        <Button type="submit" size="lg" className="w-full" disabled={loading}>
          {loading ? "Sending link…" : "Send reset link"} <ArrowRight className="h-4 w-4" />
        </Button>
      </form>

      {error && (
        <p className="mt-3 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-700">{error}</p>
      )}

      <Link
        href="/login"
        className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-700"
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
        <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">Loading…</div>
      }
    >
      <ForgotPasswordForm />
    </Suspense>
  );
}
