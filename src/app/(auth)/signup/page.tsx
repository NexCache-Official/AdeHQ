"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthShell } from "@/components/AuthShell";
import { Button } from "@/components/ui";
import { useStore } from "@/lib/demo-store";
import { ArrowRight, Sparkles } from "lucide-react";

export default function SignupPage() {
  const { actions, error: storeError } = useStore();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setError(null);
    if (!email.trim() || !password) {
      setError("Enter an email and password to create a workspace.");
      return;
    }
    if (password.length < 6) {
      setError("Use a password with at least 6 characters.");
      return;
    }

    setLoading(true);
    try {
      await actions.signup(
        { name: name || "Workspace Owner", email: email.trim() },
        workspace || "My AI Workspace",
        password,
      );
      router.replace("/onboarding");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create workspace.");
    } finally {
      setLoading(false);
    }
  };

  const demo = () => {
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
        Create your AI workforce.
      </h1>
      <p className="mt-1.5 text-sm text-slate-500">
        Create a real workspace, invite your team, and hire your first AI employee.
      </p>

      <form
        className="mt-7 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-slate-500">Name</span>
          <input
            className="input-field"
            placeholder="Shubham Kumar"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
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
        <div className="grid grid-cols-2 gap-3">
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
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-500">Workspace name</span>
            <input
              className="input-field"
              placeholder="Acme HQ"
              value={workspace}
              onChange={(e) => setWorkspace(e.target.value)}
            />
          </label>
        </div>
        <Button type="submit" size="lg" className="w-full">
          {loading ? "Creating..." : "Create workspace"} <ArrowRight className="h-4 w-4" />
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

      <Button variant="secondary" size="lg" className="w-full" onClick={demo}>
        <Sparkles className="h-4 w-4" />
        Continue with demo workspace
      </Button>

      <p className="mt-6 text-center text-sm text-slate-500">
        Already have a workspace?{" "}
        <Link href="/login" className="font-medium text-accent-600 hover:text-accent-700">
          Enter workspace
        </Link>
      </p>
    </AuthShell>
  );
}
