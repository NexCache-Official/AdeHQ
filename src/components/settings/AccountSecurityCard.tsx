"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, Button } from "@/components/ui";
import { PasswordStrengthField } from "@/components/auth/PasswordStrengthField";
import { getPasswordStrength, passwordsMatch } from "@/lib/auth/password";
import { authHeaders } from "@/lib/api/auth-client";
import { useStore } from "@/lib/demo-store";
import { Check, KeyRound, Mail } from "lucide-react";

export function AccountSecurityCard() {
  const { state, backend } = useStore();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const strength = getPasswordStrength(newPassword);
  const match = passwordsMatch(newPassword, confirmPassword);
  const isSupabase = backend === "supabase";

  const changePassword = async () => {
    setError(null);
    setSaved(false);

    if (!currentPassword.trim()) {
      setError("Enter your current password to confirm this change.");
      return;
    }
    if (!strength.passed) {
      setError("Use a stronger password: 8+ characters, a mix of character types, and no obvious patterns.");
      return;
    }
    if (!match) {
      setError("New passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "Unable to change password.");
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to change password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="p-6">
      <div className="mb-5 flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <KeyRound className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-ink">Password & security</h2>
          <p className="mt-1 text-sm text-ink-3">
            {isSupabase
              ? "Update your sign-in password or request a reset link by email."
              : "Password changes are available in live workspaces connected to Supabase."}
          </p>
        </div>
      </div>

      {isSupabase ? (
        <div className="space-y-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-3">Account email</span>
            <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-sm text-ink-2">
              <Mail className="h-4 w-4 shrink-0 text-ink-3" />
              {state.user?.email ?? "—"}
            </div>
          </label>

          <PasswordStrengthField
            label="Current password"
            value={currentPassword}
            onChange={setCurrentPassword}
            showStrength={false}
            placeholder="Enter current password"
          />
          <PasswordStrengthField label="New password" value={newPassword} onChange={setNewPassword} />
          <PasswordStrengthField
            label="Confirm new password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            showStrength={false}
            placeholder="Re-enter new password"
          />
          {confirmPassword.length > 0 && (
            <p className={`text-xs ${match ? "text-emerald-700" : "text-rose-600"}`}>
              {match ? "Passwords match." : "Passwords do not match yet."}
            </p>
          )}

          {error && (
            <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-700">{error}</p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <Link href="/forgot-password" className="text-sm font-medium text-accent-600 hover:text-accent-700">
              Email me a reset link instead
            </Link>
            <Button
              size="sm"
              onClick={() => void changePassword()}
              disabled={loading || !strength.passed || !match || !currentPassword}
            >
              <Check className="h-4 w-4" />
              {saved ? "Password updated" : loading ? "Updating…" : "Update password"}
            </Button>
          </div>
        </div>
      ) : (
        <p className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm text-ink-3">
          Switch to your live workspace to manage account security.
        </p>
      )}
    </Card>
  );
}
