"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/demo-store";
import { OnboardingFlow } from "@/components/OnboardingFlow";
import { LoadingState } from "@/components/States";

export default function OnboardingPage() {
  const { state, hydrated } = useStore();
  const router = useRouter();

  useEffect(() => {
    if (!hydrated) return;
    if (!state.user) router.replace("/login");
    else if (state.onboardingComplete) router.replace("/");
  }, [hydrated, state.user, state.onboardingComplete, router]);

  if (!hydrated || !state.user || state.onboardingComplete) {
    return <LoadingState full />;
  }

  return <OnboardingFlow />;
}
