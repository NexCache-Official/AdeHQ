"use client";

import { useCallback, useEffect, useState } from "react";
import { authHeaders } from "@/lib/api/auth-client";
import { PageHeader } from "@/components/Page";
import { Card, Toggle } from "@/components/ui";
import { Bell, ShieldCheck } from "lucide-react";

type Prefs = {
  product_updates: boolean;
  weekly_reports: boolean;
  activity_notifications: boolean;
};

const CATEGORIES: { key: keyof Prefs; title: string; description: string }[] = [
  { key: "product_updates", title: "Product updates", description: "New features, milestones, and welcome emails." },
  { key: "weekly_reports", title: "Weekly reports", description: "Workspace summaries, work-hours alerts, and intelligence reports." },
  { key: "activity_notifications", title: "Activity notifications", description: "Mentions, completed research/tasks, and approval requests." },
];

export default function NotificationsSettingsPage() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<keyof Prefs | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/email/preferences", { headers });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Failed to load preferences.");
      setPrefs(body.preferences);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load preferences.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (key: keyof Prefs, value: boolean) => {
    if (!prefs) return;
    setError(null);
    setSavingKey(key);
    const previous = prefs;
    setPrefs({ ...prefs, [key]: value });
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/email/preferences", {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Failed to save.");
      setPrefs(body.preferences);
    } catch (err) {
      setPrefs(previous);
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Email notifications"
        subtitle="Choose which non-essential emails you receive. Account, security, and billing emails are always sent."
      />

      {error ? (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <Card className="p-0">
        {loading || !prefs ? (
          <div className="p-6 text-sm text-ink-3">Loading preferences…</div>
        ) : (
          <div className="divide-y divide-border-2">
            {CATEGORIES.map((cat) => (
              <div key={cat.key} className="flex items-center justify-between gap-4 p-4">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent-d">
                    <Bell className="h-4 w-4" />
                  </span>
                  <div>
                    <div className="text-sm font-medium text-ink">{cat.title}</div>
                    <div className="text-xs text-ink-3">{cat.description}</div>
                  </div>
                </div>
                <Toggle
                  checked={prefs[cat.key]}
                  disabled={savingKey === cat.key}
                  onChange={(v) => toggle(cat.key, v)}
                />
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="mt-4 flex items-start gap-2 text-xs text-ink-3">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
        <span>
          Account, security, and billing emails (sign-in links, password changes, receipts) are
          always delivered and can&apos;t be turned off.
        </span>
      </div>
    </>
  );
}
