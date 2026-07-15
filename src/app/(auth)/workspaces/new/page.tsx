"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { AuthShell } from "@/components/AuthShell";
import { Button } from "@/components/ui";
import { useConfirmedEmailGate } from "@/components/auth/useConfirmedEmailGate";
import { LoadingState } from "@/components/States";
import { useStore } from "@/lib/demo-store";
import { NEW_WORKSPACE_FOCUS_KEY } from "@/lib/hiring/data";

export default function NewWorkspacePage() {
  const { state, actions, hydrated } = useStore();
  const router = useRouter();
  const emailGate = useConfirmedEmailGate();
  const [name, setName] = useState("");
  const [focus, setFocus] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hydrated || emailGate !== "allowed") return;
    if (!state.user) router.replace("/login");
  }, [hydrated, emailGate, state.user, router]);

  const submit = async () => {
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter a workspace name.");
      return;
    }

    setLoading(true);
    try {
      const focusTrimmed = focus.trim();
      if (focusTrimmed) {
        sessionStorage.setItem(NEW_WORKSPACE_FOCUS_KEY, focusTrimmed);
      } else {
        sessionStorage.removeItem(NEW_WORKSPACE_FOCUS_KEY);
      }
      await actions.createWorkspace(trimmed);
      router.replace("/onboarding");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create workspace.");
    } finally {
      setLoading(false);
    }
  };

  if (emailGate !== "allowed" || !hydrated || !state.user) {
    return <LoadingState full label="Loading…" />;
  }

  return (
    <AuthShell scene="createWorkspace">
      <h1 className="mb-2 text-[27px] font-semibold leading-[1.15] tracking-[-0.03em] text-[#111113]">
        Name this headquarters.
      </h1>
      <p className="mb-7 text-[14.5px] leading-relaxed text-[#111113]/55">
        Each workspace gets its own rooms, employees, and onboarding. You&apos;ll finish setup
        before product access.
      </p>

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold text-slate-500">Workspace name</span>
          <input
            className="input-field"
            placeholder="Acme Growth HQ"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold text-slate-500">
            What will this workspace focus on?{" "}
            <span className="font-normal text-slate-400">(optional)</span>
          </span>
          <input
            className="input-field"
            placeholder="Outbound sales, support, ops…"
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
          />
        </label>
        <Button type="submit" size="lg" className="w-full" disabled={loading}>
          {loading ? "Creating…" : "Continue to onboarding"} <ArrowRight className="h-4 w-4" />
        </Button>
      </form>

      {error ? (
        <p className="mt-3 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-700">{error}</p>
      ) : null}

      <p className="mt-[26px] text-center text-[13.5px] text-[#111113]/55">
        <Link href="/" className="font-semibold text-[#111113] hover:underline">
          Cancel and go back
        </Link>
      </p>
    </AuthShell>
  );
}
