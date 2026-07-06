"use client";

import { useState } from "react";
import { authHeaders } from "@/lib/api/auth-client";
import { Button, Card, Toggle } from "@/components/ui";
import {
  AdminAsync,
  AdminPageHeader,
  useAdminData,
} from "@/components/admin/common";
import { usePlatformAdmin } from "@/components/admin/AdminShell";
import { Wrench } from "lucide-react";

type MaintenanceResponse = {
  flags: Record<string, unknown>;
  events: {
    id: string;
    mode: string;
    enabled: boolean;
    message: string | null;
    started_at: string;
    ended_at: string | null;
  }[];
};

const TOGGLES: { key: string; label: string; flagKey: string }[] = [
  { key: "maintenance_mode", label: "Maintenance mode", flagKey: "maintenance_mode" },
  { key: "signups_enabled", label: "Signups enabled", flagKey: "signups_enabled" },
  { key: "ai_runs_enabled", label: "AI runs enabled", flagKey: "ai_runs_enabled" },
  { key: "browser_research_enabled", label: "Browser research enabled", flagKey: "browser_research_enabled" },
  { key: "file_uploads_enabled", label: "File uploads enabled", flagKey: "file_uploads_enabled" },
];

export default function AdminMaintenancePage() {
  const admin = usePlatformAdmin();
  const { data, loading, error, refresh } = useAdminData<MaintenanceResponse>(
    "/api/admin/maintenance",
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const canWrite = admin.role === "super_admin" || admin.role === "ops_admin";

  const postToggle = async (toggle: string, enabled: boolean) => {
    if (!window.confirm(`Change ${toggle}? This is audited.`)) return;
    setBusy(toggle);
    setActionError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/admin/maintenance", {
        method: "POST",
        headers,
        body: JSON.stringify({ toggle, enabled, reason: "Admin maintenance control" }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Update failed.");
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Update failed.");
    } finally {
      setBusy(null);
    }
  };

  const saveMessage = async () => {
    setBusy("maintenance_message");
    setActionError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/admin/maintenance", {
        method: "POST",
        headers,
        body: JSON.stringify({ toggle: "maintenance_message", message }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Update failed.");
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Update failed.");
    } finally {
      setBusy(null);
    }
  };

  const flagBool = (key: string): boolean => {
    const value = data?.flags[key];
    return value === true;
  };

  return (
    <div>
      <AdminPageHeader
        title="Maintenance"
        subtitle="Platform kill switches and announcement banner."
        icon={<Wrench className="h-5 w-5" />}
      />

      {actionError && <p className="mb-3 text-sm text-danger">{actionError}</p>}

      <AdminAsync loading={loading} error={error}>
        {data && (
          <div className="space-y-6">
            <Card className="space-y-4 p-5">
              <h2 className="text-sm font-semibold text-ink">Platform controls</h2>
              {TOGGLES.map((toggle) => (
                <div key={toggle.key} className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-ink">{toggle.label}</p>
                    <p className="font-mono text-[11px] text-ink-3">{toggle.flagKey}</p>
                  </div>
                  <Toggle
                    checked={flagBool(toggle.flagKey)}
                    disabled={!canWrite || busy === toggle.key}
                    onChange={(enabled) => void postToggle(toggle.key, enabled)}
                  />
                </div>
              ))}
            </Card>

            <Card className="space-y-3 p-5">
              <h2 className="text-sm font-semibold text-ink">Announcement banner</h2>
              <textarea
                className="input-field min-h-[80px] w-full text-sm"
                placeholder="Message shown during maintenance…"
                value={message || String(data.flags.maintenance_message ?? "")}
                onChange={(e) => setMessage(e.target.value)}
                disabled={!canWrite}
              />
              {canWrite && (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy === "maintenance_message"}
                  onClick={() => void saveMessage()}
                >
                  Save banner
                </Button>
              )}
            </Card>

            <Card className="p-5">
              <h2 className="mb-3 text-sm font-semibold text-ink">Recent maintenance events</h2>
              {data.events.length === 0 ? (
                <p className="text-sm text-ink-3">No events recorded.</p>
              ) : (
                <div className="space-y-2">
                  {data.events.map((event) => (
                    <div key={event.id} className="flex items-center justify-between text-sm">
                      <span className="text-ink-2">
                        {event.mode}{" "}
                        <span className={event.enabled ? "text-amber-600" : "text-ink-3"}>
                          ({event.enabled ? "active" : "ended"})
                        </span>
                      </span>
                      <span className="text-xs text-ink-3">
                        {new Date(event.started_at).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        )}
      </AdminAsync>
    </div>
  );
}
