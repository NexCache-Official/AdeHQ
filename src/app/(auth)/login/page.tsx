"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthShell } from "@/components/AuthShell";
import { Button } from "@/components/ui";
import { useStore } from "@/lib/demo-store";
import { ArrowRight, Sparkles } from "lucide-react";

export default function LoginPage() {
  const { state, actions, error: storeError } = useStore();
  const router = useRouter();
  const [email, setEmail] = useState(state.user?.email ?? "");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enter = async () => {
    setError(null);
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }

    setLoading(true);
    try {
      await actions.login(email.trim(), password);
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to log in.");
    } finally {
      setLoading(false);
    }
  };

  const continueDemo = () => {
    actions.loginDemo();
    router.replace("/");
  };

  return (
    <AuthShell>
      <div className="mb-8 lg:hidden">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-accent-500 to-glow-amber">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <span className="text-lg font-semibold text-slate-900">AdeHQ</span>
        </div>
      </div>

      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
        Welcome back to AdeHQ.
      </h1>
      <p className="mt-1.5 text-sm text-slate-500">
        Your AI employees are ready to work.
      </p>

      <form
        className="mt-7 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          enter();
        }}
      >
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-slate-500">Email</span>
          <input
            type="email"
            className="input-field"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-slate-500">Password</span>
          <input
            type="password"
            className="input-field"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <Button type="submit" size="lg" className="w-full">
          {loading ? "Entering..." : "Enter workspace"} <ArrowRight className="h-4 w-4" />
        </Button>
      </form>

      {(error || storeError) && (
        <p className="mt-3 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-700">
          {error ?? storeError}
        </p>
      )}

      <div className="my-5 flex items-center gap-3 text-xs text-slate-600">
        <span className="h-px flex-1 bg-slate-100" />
        or
        <span className="h-px flex-1 bg-slate-100" />
      </div>

      <Button variant="secondary" size="lg" className="w-full" onClick={continueDemo}>
        <Sparkles className="h-4 w-4" />
        Continue as Demo Founder
      </Button>

      <p className="mt-6 text-center text-sm text-slate-500">
        New here?{" "}
        <Link href="/signup" className="font-medium text-accent-600 hover:text-accent-700">
          Create your AI workforce
        </Link>
      </p>
    </AuthShell>
  );
}
