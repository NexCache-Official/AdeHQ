"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { HireFlow } from "@/components/hiring/HireFlow";
import { useConfirmedEmailGate } from "@/components/auth/useConfirmedEmailGate";
import { LoadingState } from "@/components/States";
import { useStore } from "@/lib/demo-store";

function HirePageInner() {
  const { state, hydrated } = useStore();
  const router = useRouter();
  const searchParams = useSearchParams();
  const onboarding = searchParams.get("onboarding") === "1";
  const entrySource =
    searchParams.get("entry") === "top_nav"
      ? ("top_nav_hire_button" as const)
      : ("hire_route" as const);
  const emailGate = useConfirmedEmailGate();

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
    if (!onboarding && !state.onboardingComplete) {
      router.replace("/onboarding");
    }
  }, [hydrated, state.user, state.workspace.id, state.onboardingComplete, onboarding, emailGate, router]);

  if (emailGate !== "allowed" || !hydrated || !state.user || !state.workspace.id) {
    return <LoadingState full label="Loading…" />;
  }

  if (!onboarding && !state.onboardingComplete) {
    return <LoadingState full label="Redirecting…" />;
  }

  return <HireFlow onboarding={onboarding} entrySource={entrySource} />;
}

export default function HirePage() {
  return (
    <Suspense fallback={<LoadingState full label="Loading…" />}>
      <HirePageInner />
    </Suspense>
  );
}
