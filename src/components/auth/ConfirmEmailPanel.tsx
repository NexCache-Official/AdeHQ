"use client";

import Link from "next/link";
import { Mail } from "lucide-react";
import { ResendConfirmation } from "@/components/auth/ResendConfirmation";

type Props = {
  email: string;
  /** Where “Use a different email” should go. Defaults to signup. */
  changeEmailHref?: string;
};

/**
 * Verify-email left panel — matches Login.dc verify scene:
 * centered envelope, short copy, secondary Resend, “Wrong inbox?” link.
 * No status chips, checklist banners, or primary “Already confirmed” CTA.
 */
export function ConfirmEmailPanel({
  email,
  changeEmailHref = "/signup",
}: Props) {
  return (
    <div className="animate-[lgScaleIn_0.5s_cubic-bezier(0.2,0.7,0.3,1)_both] text-center">
      <div className="relative mx-auto mb-[26px] h-[76px] w-[76px]">
        <div
          aria-hidden
          className="absolute inset-0 animate-[lgPulseRing_2.2s_ease-out_infinite] rounded-full bg-[linear-gradient(140deg,rgb(var(--c-accent)),rgb(var(--c-accent-2)))] opacity-[0.16]"
        />
        <div
          aria-hidden
          className="absolute inset-2 animate-[lgPulseRing_2.2s_ease-out_0.5s_infinite] rounded-full bg-[linear-gradient(140deg,rgb(var(--c-accent)),rgb(var(--c-accent-2)))] opacity-[0.16]"
        />
        <div className="relative flex h-[76px] w-[76px] items-center justify-center rounded-full bg-ink text-white animate-[lgPop_0.5s_cubic-bezier(0.2,0.8,0.3,1.2)_both]">
          <Mail className="h-[30px] w-[30px]" strokeWidth={1.8} />
        </div>
      </div>

      <h1 className="mb-2.5 text-[25px] font-semibold leading-[1.15] tracking-[-0.4px] text-ink">
        Check your inbox.
      </h1>
      <p className="mb-7 text-[14.5px] leading-[1.55] text-ink-2">
        We&apos;ve sent a confirmation link to
        <br />
        <strong className="font-semibold text-ink">
          {email.trim() || "your email"}
        </strong>
        . One click and your workspace goes live.
      </p>

      <ResendConfirmation
        email={email}
        showEmailInput={false}
        compact
        labelIdle="Resend email"
      />

      <p className="mt-5 text-[13px] text-ink-3">
        Wrong inbox?{" "}
        <Link
          href={changeEmailHref}
          className="font-semibold text-ink no-underline hover:underline"
        >
          Use a different email
        </Link>
      </p>
    </div>
  );
}
