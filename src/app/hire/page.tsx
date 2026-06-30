"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { HireFlow } from "@/components/hiring/HireFlow";
import { LoadingState } from "@/components/States";
import { useStore } from "@/lib/demo-store";

function HirePageInner() {
  const { state, hydrated } = useStore();
  const router = useRouter();
  const searchParams = useSearchParams();
  const onboarding = searchParams.get("onboarding") === "1";

  useEffect(() => {
    if (!hydrated) return;
    if (!state.user) {
      router.replace("/login");
      return;
    }
    if (!onboarding && !state.onboardingComplete) {
      router.replace("/onboarding");
    }
  }, [hydrated, state.user, state.onboardingComplete, onboarding, router]);

  if (!hydrated || !state.user) {
    return <LoadingState full label="Loading…" />;
  }

  if (!onboarding && !state.onboardingComplete) {
    return <LoadingState full label="Redirecting…" />;
  }

  return <HireFlow onboarding={onboarding} />;
}

export default function HirePage() {
  return (
    <Suspense fallback={<LoadingState full label="Loading…" />}>
      <HirePageInner />
    </Suspense>
  );
}
