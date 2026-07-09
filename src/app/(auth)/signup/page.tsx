"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthShell } from "@/components/AuthShell";
import { Button } from "@/components/ui";
import { useStore } from "@/lib/demo-store";
import { ResendConfirmation } from "@/components/auth/ResendConfirmation";
import { ENABLE_DEMO_MODE } from "@/lib/config/features";
import { getSiteUrl } from "@/lib/site-url";
import { ArrowRight, Check, Eye, EyeOff, Sparkles } from "lucide-react";

function getPasswordStrength(password: string) {
  const hasLength = password.length >= 8;
  const hasMix =
    [/[a-z]/.test(password), /[A-Z]/.test(password), /[0-9]/.test(password), /[^A-Za-z0-9]/.test(password)].filter(Boolean).length >= 3;
  const hasNoObviousPattern = password.length > 0 && !/(.)\1{2,}/.test(password) && !/(password|adehq|qwerty|123456|letmein)/i.test(password);
  const score = (hasLength ? 1 : 0) + (hasMix ? 2 : 0) + (hasNoObviousPattern ? 1 : 0);
  const passed = hasLength && score >= 3;
  const label = score >= 4 ? "Strong" : score >= 3 ? "Good" : score >= 2 ? "Getting there" : "Too weak";
  const percent = password ? Math.min(100, Math.max(18, score * 25)) : 0;
  return { hasLength, hasMix, hasNoObviousPattern, score, passed, label, percent };
}

function PasswordRequirement({ met, children }: { met: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-xs leading-relaxed text-slate-500">
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] transition ${
          met ? "bg-emerald-500 text-white" : "bg-slate-100 text-slate-400"
        }`}
      >
        {met && <Check className="h-3 w-3" />}
      </span>
      {children}
    </div>
  );
}

export default function SignupPage() {
  const { actions, error: storeError } = useStore();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmationSent, setConfirmationSent] = useState(false);
  const [confirmationEmail, setConfirmationEmail] = useState("");
  const [repeatedSignup, setRepeatedSignup] = useState(false);
  const [signupsDisabled, setSignupsDisabled] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const passwordStrength = getPasswordStrength(password);

  useEffect(() => {
    actions.clearError();
  }, [actions]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/platform/status");
        if (!res.ok || cancelled) return;
        const body = await res.json();
        if (!body.signupsEnabled) setSignupsDisabled(true);
      } catch {
        // fail open
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const create = async () => {
    setError(null);
    actions.clearError();
    if (!email.trim() || !password) {
      setError("Enter an email and password to create a workspace.");
      return;
    }
    if (!passwordStrength.passed) {
      setError("Use a stronger password: 8+ characters, a mix of character types, and no obvious patterns.");
      return;
    }

    setLoading(true);
    try {
      const result = await actions.signup(
        { name: name || "Workspace Owner", email: email.trim() },
        workspace || "My AI Workspace",
        password,
      );
      if (result.needsEmailConfirmation) {
        setConfirmationEmail(email.trim());
        setRepeatedSignup(Boolean(result.repeatedSignup));
        setConfirmationSent(true);
        return;
      }
      router.replace("/onboarding");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create workspace.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell>
      <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.03em] text-slate-950">
        Create your HQ.
      </h1>
      <p className="mt-2 text-[15px] leading-relaxed text-slate-500">
        Start with a secure workspace and your first AI teammate can join minutes later.
      </p>

      {signupsDisabled && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          New signups are temporarily disabled. Please check back later or contact support.
        </div>
      )}

      {confirmationSent ? (
        <div className="mt-7 rounded-[18px] border border-emerald-200 bg-emerald-50 px-5 py-4 text-left shadow-sm">
          <h2 className="text-sm font-semibold text-emerald-950">Check your email</h2>
          <p className="mt-2 text-sm leading-relaxed text-emerald-800">
            {repeatedSignup ? (
              <>
                An account for <span className="font-medium">{confirmationEmail}</span> already exists.
                We sent a fresh confirmation link if your email was still unverified.
              </>
            ) : (
              <>
                We sent a confirmation link to{" "}
                <span className="font-medium">{confirmationEmail}</span>. Click it to activate your
                account and continue to onboarding.
              </>
            )}
          </p>
          <p className="mt-3 text-xs text-emerald-700">
            The email comes from AdeHQ (<span className="font-mono">noreply@adehq.com</span>
            ). Check spam or promotions if you do not see it within a minute.
          </p>
          <p className="mt-2 text-xs text-emerald-700">
            The link returns you to{" "}
            <span className="font-medium">{getSiteUrl().replace(/^https?:\/\//, "")}</span> at{" "}
            <span className="font-mono">/auth/callback</span>.
          </p>
          <Link
            href="/login"
            className="mt-4 inline-flex text-sm font-medium text-accent-600 hover:text-accent-700"
          >
            Already confirmed? Enter workspace →
          </Link>
          <div className="mt-5 border-t border-emerald-200 pt-4">
            <p className="mb-3 text-xs text-emerald-800">Link expired or didn&apos;t arrive?</p>
            <ResendConfirmation email={confirmationEmail} showEmailInput={false} />
          </div>
        </div>
      ) : (
        <>
          <form
            className="mt-7 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              create();
            }}
          >
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-slate-500">Full name</span>
              <input
                className="input-field"
                placeholder="Shubham Kumar"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-slate-500">Work email</span>
              <input
                type="email"
                className="input-field"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-slate-500">Password</span>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  className="input-field pr-11"
                  placeholder="8+ chars with a mix of types"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                  onClick={() => setShowPassword((value) => !value)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {password && (
                <div className="mt-2 rounded-xl border border-slate-200 bg-white/80 p-3">
                  <div className="flex items-center gap-3">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          passwordStrength.passed ? "bg-emerald-500" : "bg-amber-400"
                        }`}
                        style={{ width: `${passwordStrength.percent}%` }}
                      />
                    </div>
                    <span
                      className={`text-xs font-semibold ${
                        passwordStrength.passed ? "text-emerald-700" : "text-amber-700"
                      }`}
                    >
                      {passwordStrength.label}
                    </span>
                  </div>
                  <div className="mt-3 space-y-1.5">
                    <PasswordRequirement met={passwordStrength.hasLength}>
                      At least 8 characters
                    </PasswordRequirement>
                    <PasswordRequirement met={passwordStrength.hasMix}>
                      Use 3 of: uppercase, lowercase, number, symbol
                    </PasswordRequirement>
                    <PasswordRequirement met={passwordStrength.hasNoObviousPattern}>
                      Avoid repeated letters or obvious words
                    </PasswordRequirement>
                  </div>
                </div>
              )}
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-slate-500">Workspace name</span>
              <input
                className="input-field"
                placeholder="Acme HQ"
                value={workspace}
                onChange={(e) => setWorkspace(e.target.value)}
              />
            </label>
            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={loading || signupsDisabled || Boolean(password && !passwordStrength.passed)}
            >
              {loading ? "Creating..." : signupsDisabled ? "Signups disabled" : "Create account"}{" "}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </form>

          {(error || storeError) && (
            <p className="mt-3 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-700">
              {error ?? storeError}
            </p>
          )}

          {ENABLE_DEMO_MODE && (
            <>
              <div className="my-5 flex items-center gap-3 text-xs text-slate-600">
                <span className="h-px flex-1 bg-slate-100" />
                or
                <span className="h-px flex-1 bg-slate-100" />
              </div>

              <Button
                variant="secondary"
                size="lg"
                className="w-full"
                onClick={() => {
                  actions.loginDemo();
                  router.replace("/");
                }}
              >
                <Sparkles className="h-4 w-4" />
                Continue with demo workspace
              </Button>
            </>
          )}

          <p className="mt-6 text-center text-sm text-slate-500">
            Already have a workspace?{" "}
            <Link href="/login" className="font-medium text-accent-600 hover:text-accent-700">
              Enter workspace
            </Link>
          </p>
        </>
      )}
    </AuthShell>
  );
}
