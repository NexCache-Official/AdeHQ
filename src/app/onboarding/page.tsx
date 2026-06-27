"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { OnboardingFlow } from "@/components/OnboardingFlow";
import { LoadingState } from "@/components/States";
import { useStore } from "@/lib/demo-store";

export default function OnboardingPage() {
  const { state, hydrated } = useStore();
  const router = useRouter();

  useEffect(() => {
    if (!hydrated) return;
    if (!state.user) router.replace("/login");
    else if (state.onboardingComplete) router.replace("/");
  }, [hydrated, state.user, state.onboardingComplete, router]);

  if (!hydrated || !state.user) return <LoadingState full label="Loading…" />;

  return (
    <div className="min-h-screen bg-slate-50">
      <OnboardingFlow />
    </div>
  );
}
