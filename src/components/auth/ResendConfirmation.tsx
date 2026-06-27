"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { resendSignupConfirmation } from "@/lib/auth/confirmation";
import { Mail } from "lucide-react";

type Props = {
  email?: string;
  showEmailInput?: boolean;
  className?: string;
};

export function ResendConfirmation({ email: initialEmail = "", showEmailInput = true, className }: Props) {
  const [email, setEmail] = useState(initialEmail);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resend = async () => {
    setError(null);
    setBusy(true);
    try {
      await resendSignupConfirmation(email);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to resend confirmation email.");
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className={`rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 ${className ?? ""}`}>
        New confirmation link sent to <span className="font-medium">{email}</span>. Check your inbox and spam
        folder.
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${className ?? ""}`}>
      {showEmailInput && (
        <label className="block space-y-1.5 text-left">
          <span className="text-xs font-medium text-slate-500">Email</span>
          <input
            type="email"
            className="input-field"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
      )}
      <Button type="button" variant="secondary" className="w-full" onClick={resend} disabled={busy || !email.trim()}>
        <Mail className="h-4 w-4" />
        {busy ? "Sending…" : "Resend confirmation email"}
      </Button>
      {error && <p className="text-left text-sm text-rose-700">{error}</p>}
    </div>
  );
}
