"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { resendSignupConfirmation } from "@/lib/auth/confirmation";

type Props = {
  email?: string;
  showEmailInput?: boolean;
  className?: string;
  /** Match Login.dc: secondary block button + countdown, no success banner. */
  compact?: boolean;
  labelIdle?: string;
};

export function ResendConfirmation({
  email: initialEmail = "",
  showEmailInput = true,
  className,
  compact = false,
  labelIdle = "Resend confirmation email",
}: Props) {
  const [email, setEmail] = useState(initialEmail);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    setEmail(initialEmail);
  }, [initialEmail]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setInterval(() => {
      setCooldown((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [cooldown]);

  const resend = async () => {
    if (cooldown > 0 || busy) return;
    setError(null);
    setBusy(true);
    try {
      await resendSignupConfirmation(email);
      setCooldown(30);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to resend confirmation email.");
    } finally {
      setBusy(false);
    }
  };

  const disabled = busy || !email.trim() || cooldown > 0;
  const label =
    busy ? "Sending…" : cooldown > 0 ? `Resend in ${cooldown}s` : labelIdle;

  if (compact) {
    return (
      <div className={className}>
        <Button
          type="button"
          variant="secondary"
          size="lg"
          className="h-12 w-full rounded-xl text-sm font-semibold"
          onClick={() => void resend()}
          disabled={disabled}
        >
          {label}
        </Button>
        {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${className ?? ""}`}>
      {showEmailInput && (
        <label className="block space-y-1.5 text-left">
          <span className="text-xs font-semibold text-slate-500">Email</span>
          <input
            type="email"
            className="input-field"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
      )}
      <Button
        type="button"
        variant="secondary"
        className="w-full"
        onClick={() => void resend()}
        disabled={disabled}
      >
        {label}
      </Button>
      {error && <p className="text-left text-sm text-rose-700">{error}</p>}
    </div>
  );
}
