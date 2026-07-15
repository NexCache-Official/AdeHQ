"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
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
  const { state, actions, hydrated, userWorkspaces } = useStore();
  const router = useRouter();
  const emailGate = useConfirmedEmailGate();
  const [launchPending, setLaunchPending] = useState(false);
  const [switching, setSwitching] = useState(false);

  const completedOther = useMemo(
    () =>
      userWorkspaces.find(
        (ws) => ws.onboardingComplete && ws.id !== state.workspace.id,
      ) ?? null,
    [userWorkspaces, state.workspace.id],
  );

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

  const backToCompleted = async () => {
    if (!completedOther || switching) return;
    setSwitching(true);
    try {
      await actions.switchWorkspace(completedOther.id);
      router.replace("/");
    } finally {
      setSwitching(false);
    }
  };

  // Never render the flow (even for a frame) for signed-out users or users who
  // have already completed onboarding — unless Launch handoff is in progress.
  if (emailGate !== "allowed" || !hydrated || !state.user) {
    return <LoadingState full label="Loading…" />;
  }

  if (state.onboardingComplete && !launchPending) {
    return <LoadingState full label="Loading…" />;
  }

  return (
    <div className="relative h-screen overflow-hidden bg-[var(--canvas)]">
      {completedOther ? (
        <div className="absolute left-4 top-4 z-20 sm:left-6 sm:top-5">
          <button
            type="button"
            disabled={switching}
            onClick={() => void backToCompleted()}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface/90 px-3 py-1.5 text-xs font-medium text-ink-2 shadow-sm backdrop-blur transition hover:border-accent/40 hover:text-ink disabled:opacity-60"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {switching ? "Switching…" : `Back to ${completedOther.name}`}
          </button>
        </div>
      ) : null}
      <OnboardingFlow />
    </div>
  );
}
