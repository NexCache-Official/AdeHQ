"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthShell } from "@/components/AuthShell";
import { ConfirmEmailPanel } from "@/components/auth/ConfirmEmailPanel";
import { LoadingState } from "@/components/States";
import { assertConfirmedSession } from "@/lib/auth/guards";

function ConfirmEmailInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let active = true;

    const run = async () => {
      try {
        const gate = await assertConfirmedSession();
        if (!active) return;

        if (gate.ok) {
          router.replace("/onboarding");
          return;
        }

        if (gate.reason === "signed_out" && !searchParams.get("email")) {
          router.replace("/login");
          return;
        }

        if (gate.reason === "unconfirmed" && gate.email) {
          setEmail(gate.email);
        }
      } finally {
        if (active) setChecking(false);
      }
    };

    void run();
    return () => {
      active = false;
    };
  }, [router, searchParams]);

  if (checking) {
    return <LoadingState full label="Checking your account…" />;
  }

  return (
    <AuthShell scene="verify">
      <ConfirmEmailPanel email={email} changeEmailHref="/signup" />
    </AuthShell>
  );
}

export default function ConfirmEmailPage() {
  return (
    <Suspense fallback={<LoadingState full label="Loading…" />}>
      <ConfirmEmailInner />
    </Suspense>
  );
}
