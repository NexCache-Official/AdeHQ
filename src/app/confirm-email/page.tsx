"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthShell } from "@/components/AuthShell";
import { ResendConfirmation } from "@/components/auth/ResendConfirmation";
import { LoadingState } from "@/components/States";
import { assertConfirmedSession } from "@/lib/auth/guards";
import { getSiteUrl } from "@/lib/site-url";
import { Mail, ShieldCheck } from "lucide-react";

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
      <div className="relative mb-7 h-[82px] w-[82px]">
        <span className="absolute inset-0 animate-ping rounded-full bg-accent/15" />
        <span className="absolute inset-2 animate-ping rounded-full bg-emerald-400/15 [animation-delay:500ms]" />
        <div className="relative flex h-[82px] w-[82px] items-center justify-center rounded-[24px] bg-slate-950 text-white shadow-lg">
          <Mail className="h-8 w-8" />
        </div>
      </div>
      <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.03em] text-slate-950">
        Confirm your email.
      </h1>
      <p className="mt-2 text-[15px] leading-relaxed text-slate-500">
        We sent a workspace activation link to{" "}
        {email ? <span className="font-semibold text-slate-950">{email}</span> : "your inbox"}.
      </p>

      <div className="mt-6 rounded-[18px] border border-amber-200 bg-amber-50 px-5 py-4 text-left text-sm text-amber-950">
        <div className="flex gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white text-amber-700">
            <ShieldCheck className="h-4 w-4" />
          </span>
          <div>
            <p className="font-semibold">Didn&apos;t receive the email?</p>
            <p className="mt-2 text-xs leading-relaxed text-amber-900">
              Check spam or promotions for mail from AdeHQ at{" "}
              <code className="font-mono">noreply@adehq.com</code>. Confirmation links must open on{" "}
              <span className="font-mono">{getSiteUrl()}</span>. If you signed up again with the
              same email, use resend below.
            </p>
          </div>
        </div>
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
