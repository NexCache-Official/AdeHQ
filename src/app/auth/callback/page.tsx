"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { loadWorkspaceState } from "@/lib/supabase/persistence";
import { Sparkles } from "lucide-react";

function AuthCallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [message, setMessage] = useState("Confirming your email…");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;

    const finish = async () => {
      const next = searchParams.get("next") ?? "/onboarding";
      const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/onboarding";
      const code = searchParams.get("code");
      const authError = searchParams.get("error_description") ?? searchParams.get("error");

      if (authError) {
        if (!active) return;
        setFailed(true);
        setMessage(decodeURIComponent(authError));
        return;
      }

      try {
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        }

        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (!data.session?.user) {
          throw new Error("No active session after email confirmation.");
        }

        // Create workspace if this is a fresh signup (uses user_metadata.workspace_name).
        await loadWorkspaceState(data.session.user);

        if (!active) return;
        router.replace(safeNext);
      } catch (err) {
        if (!active) return;
        setFailed(true);
        setMessage(
          err instanceof Error
            ? err.message
            : "Confirmation link expired or invalid. Try logging in.",
        );
      }
    };

    void finish();

    return () => {
      active = false;
    };
  }, [router, searchParams]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-500 to-glow-amber shadow-glow-sm">
        <Sparkles className="h-6 w-6 text-white" />
      </div>
      <p className={`mt-6 max-w-md text-center text-sm ${failed ? "text-rose-700" : "text-slate-600"}`}>
        {message}
      </p>
      {failed && (
        <a
          href="/login"
          className="mt-4 text-sm font-medium text-accent-600 hover:text-accent-700"
        >
          Go to login
        </a>
      )}
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">
          Confirming your email…
        </div>
      }
    >
      <AuthCallbackInner />
    </Suspense>
  );
}
