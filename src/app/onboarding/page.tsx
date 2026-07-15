"use client";

import { useEffect, useMemo, useState } from "react";
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
  const { state, actions, hydrated, userWorkspaces, workspaceTransitioning } = useStore();
  const router = useRouter();
  const emailGate = useConfirmedEmailGate();
  const [launchPending, setLaunchPending] = useState(false);

  const activeSummary = useMemo(
    () => userWorkspaces.find((ws) => ws.id === state.workspace.id) ?? null,
    [userWorkspaces, state.workspace.id],
  );

  const workspaceIsComplete =
    Boolean(state.onboardingComplete) ||
    Boolean(state.workspace.onboardingComplete) ||
    Boolean(activeSummary?.onboardingComplete);

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
    if (workspaceTransitioning) return;

    // Already finished in DB/list — leave wizard. Only keep Launch handoff while
    // sessionStorage says this tab is mid step-5 transition.
    if (workspaceIsComplete) {
      if (isOnboardingLaunchPending()) {
        setLaunchPending(true);
        return;
      }
      clearOnboardingLaunchPending();
      setLaunchPending(false);
      router.replace("/");
      return;
    }

    // Recovery: workspace + first room already exist but flag was never persisted
    // (older clients left users looping Welcome). Seal onboarding and leave.
    const hasProjectRoom = state.rooms.some((r) => r.kind === "room");
    if (state.workspace.id && hasProjectRoom && !isOnboardingLaunchPending()) {
      void (async () => {
        try {
          await actions.completeOnboarding();
          clearOnboardingLaunchPending();
          router.replace("/");
        } catch (err) {
          console.error("[AdeHQ onboarding recovery]", err);
        }
      })();
      return;
    }

    setLaunchPending(isOnboardingLaunchPending());
  }, [
    hydrated,
    state.user,
    state.onboardingComplete,
    state.workspace.id,
    state.workspace.onboardingComplete,
    state.rooms,
    workspaceIsComplete,
    workspaceTransitioning,
    emailGate,
    router,
    actions,
  ]);

  if (emailGate !== "allowed" || !hydrated || !state.user) {
    return <LoadingState full label="Loading…" />;
  }

  if (workspaceTransitioning) {
    return <LoadingState full label="Switching workspace…" />;
  }

  // Completed HQ: never render the wizard except the intentional Launch handoff frame.
  if (workspaceIsComplete && !launchPending) {
    return <LoadingState full label="Opening workspace…" />;
  }

  return (
    <div className="h-screen overflow-hidden bg-[var(--canvas)]">
      <OnboardingFlow
        escapeWorkspace={
          completedOther
            ? { id: completedOther.id, name: completedOther.name }
            : null
        }
        allowCancel={!workspaceIsComplete}
      />
    </div>
  );
}
