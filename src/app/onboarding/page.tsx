"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { OnboardingFlow } from "@/components/OnboardingFlow";
import { useConfirmedEmailGate } from "@/components/auth/useConfirmedEmailGate";
import { isPasswordRecoveryPending } from "@/lib/auth/recovery";
import { LoadingState } from "@/components/States";
import { useStore } from "@/lib/demo-store";
import {
  clearOnboardingLaunchPending,
  isOnboardingLaunchPending,
} from "@/lib/hiring/data";

export default function OnboardingPage() {
  const { state, actions, hydrated } = useStore();
  const router = useRouter();
  const emailGate = useConfirmedEmailGate();
  const [launchPending, setLaunchPending] = useState(false);

  useEffect(() => {
    setLaunchPending(isOnboardingLaunchPending());
  }, []);

  useEffect(() => {
    if (isPasswordRecoveryPending()) {
      router.replace("/reset-password");
      return;
    }
    if (!hydrated || emailGate !== "allowed") return;
    if (!state.user) {
      router.replace("/login");
      return;
    }

    // Recovery: workspace + first room already exist but flag was never persisted
    // (older clients left users looping Welcome). Seal onboarding and leave.
    const hasProjectRoom = state.rooms.some((r) => r.kind === "room");
    if (
      state.workspace.id &&
      hasProjectRoom &&
      !state.onboardingComplete &&
      !isOnboardingLaunchPending()
    ) {
      void (async () => {
        await actions.completeOnboarding();
        clearOnboardingLaunchPending();
        router.replace("/");
      })();
      return;
    }

    // Completed onboarding: never show the wizard again, unless this tab is
    // still on the one-shot Launch handoff after workspace provisioning.
    if (state.onboardingComplete && !isOnboardingLaunchPending()) {
      clearOnboardingLaunchPending();
      router.replace("/");
      return;
    }

    setLaunchPending(isOnboardingLaunchPending());
  }, [
    hydrated,
    state.user,
    state.onboardingComplete,
    state.workspace.id,
    state.rooms,
    emailGate,
    router,
    actions,
  ]);

  // Never render the flow (even for a frame) for signed-out users or users who
  // have already completed onboarding — unless Launch handoff is in progress.
  if (emailGate !== "allowed" || !hydrated || !state.user) {
    return <LoadingState full label="Loading…" />;
  }

  if (state.onboardingComplete && !launchPending) {
    return <LoadingState full label="Loading…" />;
  }

  return (
    <div className="h-screen overflow-hidden bg-[var(--canvas)]">
      <OnboardingFlow />
    </div>
  );
}
