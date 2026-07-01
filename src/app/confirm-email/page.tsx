"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthShell } from "@/components/AuthShell";
import { ResendConfirmation } from "@/components/auth/ResendConfirmation";
import { LoadingState } from "@/components/States";
import { assertConfirmedSession } from "@/lib/auth/guards";
import { getSiteUrl } from "@/lib/site-url";
import { Mail } from "lucide-react";

function ConfirmEmailInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let active = true;

    const run = async () => {
      try {
        const gate = await assertConfirmedSession();
        if (!active) return;

        if (gate.ok) {
          router.replace("/onboarding");
          return;
        }

        if (gate.reason === "signed_out" && !searchParams.get("email")) {
          router.replace("/login");
          return;
        }

        if (gate.reason === "unconfirmed" && gate.email) {
          setEmail(gate.email);
        }
      } finally {
        if (active) setChecking(false);
      }
    };

    void run();
    return () => {
      active = false;
    };
  }, [router, searchParams]);

  if (checking) {
    return <LoadingState full label="Checking your account…" />;
  }

  return (
    <AuthShell>
      <div className="mb-8 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--accent-soft)]">
        <Mail className="h-6 w-6 text-[var(--accent-d)]" />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Confirm your email</h1>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">
        You need to verify your email before AdeHQ can create your workspace or open onboarding.
      </p>

      <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-left text-sm text-amber-950">
        <p className="font-medium">Didn&apos;t receive the email?</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-relaxed text-amber-900">
          <li>Check spam or promotions for mail from Supabase (<code className="font-mono">noreply@mail.app.supabase.io</code>).</li>
          <li>Confirmation links must open on <span className="font-mono">{getSiteUrl()}</span>.</li>
          <li>If you signed up again with the same email, use resend below — duplicate signups do not always send a new message.</li>
        </ul>
      </div>

      <div className="mt-6">
        <ResendConfirmation email={email} />
      </div>

      <p className="mt-6 text-center text-sm text-slate-500">
        Already confirmed?{" "}
        <Link href="/login?confirmed=1" className="font-medium text-accent-600 hover:text-accent-700">
          Sign in to continue
        </Link>
      </p>
    </AuthShell>
  );
}

export default function ConfirmEmailPage() {
  return (
    <Suspense fallback={<LoadingState full label="Loading…" />}>
      <ConfirmEmailInner />
    </Suspense>
  );
}
