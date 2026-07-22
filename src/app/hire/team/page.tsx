"use client";

import { Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useConfirmedEmailGate } from "@/components/auth/useConfirmedEmailGate";
import { LoadingState } from "@/components/States";
import { useStore } from "@/lib/demo-store";
import { canManageAiEmployees } from "@/lib/workspace/permissions";
import { WorkforceStudioShell } from "@/components/hiring/workforce-studio/WorkforceStudioShell";

function TeamHirePageInner() {
  const { state, hydrated } = useStore();
  const router = useRouter();
  const emailGate = useConfirmedEmailGate();
  const myRole = state.workspaceMembers.find((m) => m.userId === state.user?.id)?.role;
  const canHire = canManageAiEmployees(myRole);

  useEffect(() => {
    if (!hydrated || emailGate !== "allowed") return;
    if (!state.user) {
      router.replace("/login");
      return;
    }
    if (!state.workspace.id) {
      router.replace("/onboarding");
      return;
    }
    if (!state.onboardingComplete) {
      router.replace("/onboarding");
      return;
    }
    if (!canHire) {
      router.replace("/workforce");
    }
  }, [hydrated, state.user, state.workspace.id, state.onboardingComplete, emailGate, canHire, router]);

  if (emailGate !== "allowed" || !hydrated || !state.user || !state.workspace.id || !state.onboardingComplete) {
    return <LoadingState full label="Loading…" />;
  }

  if (!canHire) {
    return <LoadingState full label="Redirecting…" />;
  }

  return <WorkforceStudioShell workspaceId={state.workspace.id} />;
}

export default function TeamHirePage() {
  return (
    <Suspense fallback={<LoadingState full label="Loading…" />}>
      <TeamHirePageInner />
    </Suspense>
  );
}
