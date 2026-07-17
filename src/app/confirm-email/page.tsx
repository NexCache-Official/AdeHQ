"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthShell, AuthStatusChip } from "@/components/AuthShell";
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
    <AuthShell scene="verify">
      <AuthStatusChip label="Status · awaiting confirmation" tone="accent" />
      <div className="relative mb-6 h-[82px] w-[82px]">
        <span className="absolute inset-0 animate-ping rounded-full bg-accent/15" />
        <span className="absolute inset-2 animate-ping rounded-full bg-emerald-400/15 [animation-delay:500ms]" />
        <div className="relative flex h-[82px] w-[82px] items-center justify-center rounded-[24px] bg-ink text-white shadow-lg">
          <Mail className="h-8 w-8" strokeWidth={1.75} />
        </div>
      </div>
      <h1 className="mb-2 text-[27px] font-semibold leading-[1.15] tracking-[-0.03em] text-ink">
        Confirm your email
        <span className="text-accent">.</span>
      </h1>
      <p className="text-[14.5px] leading-relaxed text-ink-2">
        We sent a workspace activation link to{" "}
        {email ? <span className="font-semibold text-ink">{email}</span> : "your inbox"}. One click
        and HQ switches on.
      </p>

      <div className="mt-6 rounded-[18px] border border-amber-200 bg-amber-50 px-4 py-3.5 text-left text-xs leading-relaxed text-amber-950">
        <p className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-amber-800/80">
          Inbox checklist
        </p>
        <p className="mt-2 text-[13px] leading-relaxed text-amber-900">
          Check spam or promotions for mail from AdeHQ at{" "}
          <code className="font-mono">noreply@adehq.com</code>. Links must open on{" "}
          <span className="font-mono">{getSiteUrl()}</span>. If you signed up again with the same
          email, use resend below.
        </p>
      </div>

      <div className="mt-6">
        <ResendConfirmation email={email} />
      </div>

      <p className="mt-7 text-center text-sm text-ink-3">
        Already confirmed?{" "}
        <Link href="/login?confirmed=1" className="font-semibold text-accent hover:text-accent-d">
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
