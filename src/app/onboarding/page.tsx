"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { OnboardingFlow } from "@/components/OnboardingFlow";
import { useConfirmedEmailGate } from "@/components/auth/useConfirmedEmailGate";
import { LoadingState } from "@/components/States";
import { useStore } from "@/lib/demo-store";

export default function OnboardingPage() {
  const { state, hydrated } = useStore();
  const router = useRouter();
  const emailGate = useConfirmedEmailGate();

  useEffect(() => {
    if (!hydrated || emailGate !== "allowed") return;
    if (!state.user) router.replace("/login");
    else if (state.onboardingComplete) router.replace("/");
  }, [hydrated, state.user, state.onboardingComplete, emailGate, router]);

  // Never render the flow (even for a frame) for signed-out users or users who
  // have already completed onboarding — they are mid-redirect to /login or /.
  if (
    emailGate !== "allowed" ||
    !hydrated ||
    !state.user ||
    state.onboardingComplete
  ) {
    return <LoadingState full label="Loading…" />;
  }

  return (
    <div className="h-screen overflow-hidden bg-[var(--canvas)]">
      <OnboardingFlow />
    </div>
  );
}
