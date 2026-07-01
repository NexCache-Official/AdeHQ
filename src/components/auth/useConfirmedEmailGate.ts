"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { assertConfirmedSession } from "@/lib/auth/guards";

type GateState = "loading" | "allowed" | "redirecting";

/** Redirects unconfirmed users to /confirm-email before protected onboarding flows. */
export function useConfirmedEmailGate(): GateState {
  const router = useRouter();
  const [state, setState] = useState<GateState>("loading");

  useEffect(() => {
    let active = true;

    const run = async () => {
      try {
        const gate = await assertConfirmedSession();
        if (!active) return;

        if (gate.ok) {
          setState("allowed");
          return;
        }

        setState("redirecting");
        if (gate.reason === "signed_out") {
          router.replace("/login");
          return;
        }

        const query = gate.email ? `?email=${encodeURIComponent(gate.email)}` : "";
        router.replace(`/confirm-email${query}`);
      } catch {
        if (!active) return;
        setState("redirecting");
        router.replace("/login");
      }
    };

    void run();
    return () => {
      active = false;
    };
  }, [router]);

  return state;
}
