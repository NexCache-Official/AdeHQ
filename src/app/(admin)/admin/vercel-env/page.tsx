"use client";

import { useCallback, useEffect, useState } from "react";
import { authHeaders } from "@/lib/api/auth-client";
import { Button, Card, Modal, ModalHeader } from "@/components/ui";
import {
  AdminAsync,
  AdminDataTable,
  AdminHealthBadge,
  AdminPageHeader,
  formatDate,
  type AdminColumn,
} from "@/components/admin/common";
import { usePlatformAdmin } from "@/components/admin/AdminShell";
import { KeyRound, Plus, RefreshCw, ShieldAlert } from "lucide-react";

type EnvRow = {
  id: string;
  key: string;
  type: string;
  target: string[];
  gitBranch: string | null;
  comment: string | null;
  system: boolean;
  integrationManaged: boolean;
  valuePreview: string;
  updatedAt: number | null;
};

type ListResponse = {
  configured: boolean;
  projectIdOrName: string | null;
  envs: EnvRow[];
  hiddenProductionEnvCount?: number;
};

const TARGETS = ["production", "preview", "development"] as const;

export default function AdminVercelEnvPage() {
  const admin = usePlatformAdmin();
  const isSuperAdmin = admin.role === "super_admin";

  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<EnvRow | null>(null);

  const load = useCallback(async () => {
    if (!isSuperAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/admin/vercel/env", { headers });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Failed to load environment variables.");
      setData(body as ListResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load environment variables.");
    } finally {
      setLoading(false);
    }
  }, [isSuperAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!isSuperAdmin) {
    return (
      <div>
        <AdminPageHeader
          title="Vercel Environment"
          subtitle="Super admin only."
          icon={<KeyRound className="h-5 w-5" />}
        />
        <Card className="p-6 text-sm text-ink-3">
          Only AdeHQ super admins can manage Vercel environment variables.
        </Card>
      </div>
    );
  }

  const columns: AdminColumn<EnvRow>[] = [
    { key: "key", header: "Key", render: (e) => <span className="font-mono text-xs font-medium text-ink">{e.key}</span> },
    { key: "value", header: "Value", render: (e) => <span className="font-mono text-xs text-ink-3">{e.valuePreview}</span> },
    { key: "type", header: "Type", render: (e) => <span className="text-xs capitalize">{e.type}</span> },
    {
      key: "target",
      header: "Targets",
      render: (e) => (
        <div className="flex flex-wrap gap-1">
          {e.target.map((t) => (
            <span key={t} className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] uppercase text-ink-3">
              {t}
            </span>
          ))}
        </div>
      ),
    },
    {
      key: "flags",
      header: "Flags",
      render: (e) => (
        <div className="flex flex-wrap gap-1">
          {e.system && <AdminHealthBadge tone="unknown" label="System" />}
          {e.integrationManaged && <AdminHealthBadge tone="degraded" label="Integration" />}
          {e.key.startsWith("NEXT_PUBLIC_") && <AdminHealthBadge tone="degraded" label="Public" />}
        </div>
      ),
    },
    {
      key: "updated",
      header: "Updated",
      render: (e) =>
        e.updatedAt ? formatDate(new Date(e.updatedAt).toISOString()) : "—",
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (e) =>
        e.system || e.integrationManaged ? (
          <span className="text-xs text-ink-3">Read-only</span>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setEditing(e)}>
            Edit
          </Button>
        ),
    },
  ];

  return (
    <div>
      <AdminPageHeader
        title="Vercel Environment"
        subtitle="Manage deployment secrets via the Vercel API. Values are never shown after save."
        icon={<KeyRound className="h-5 w-5" />}
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
            <Button size="sm" onClick={() => setCreating(true)} disabled={!data?.configured}>
              <Plus className="h-3.5 w-3.5" /> Add variable
            </Button>
          </div>
        }
      />

      <Card className="mb-4 border-amber-500/30 bg-amber-500/[0.06] p-4 text-sm text-amber-800">
        <div className="flex gap-2">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">Security rules</p>
            <ul className="mt-1 list-inside list-disc space-y-0.5 text-amber-900/90">
              <li>Secret values are write-only — you cannot read them back after saving.</li>
              <li>All changes require a reason and are written to the audit log (never the secret value).</li>
              <li>Protected keys (API tokens, Supabase secret, etc.) require typing the key name to delete.</li>
              <li>Changes apply to Vercel deployments; redeploy or wait for the next build to take effect.</li>
            </ul>
          </div>
        </div>
      </Card>

      {!loading && data && !data.configured && (
        <Card className="mb-4 p-6 text-sm text-ink-2">
          <p className="font-medium text-ink">Vercel API not configured on this deployment</p>
          <p className="mt-2 text-ink-3">
            Set <code className="text-xs">VERCEL_API_TOKEN</code> (or{" "}
            <code className="text-xs">VERCEL_ACCESS_TOKEN</code>) on this Vercel project, plus{" "}
            <code className="text-xs">VERCEL_PROJECT_ID</code> or{" "}
            <code className="text-xs">VERCEL_PROJECT_NAME</code>. Optionally set{" "}
            <code className="text-xs">VERCEL_TEAM_ID</code> or{" "}
            <code className="text-xs">VERCEL_TEAM_SLUG</code> for team projects.
          </p>
        </Card>
      )}

      {data?.configured && (
        <p className="mb-3 text-xs text-ink-3">
          Project: <span className="font-mono">{data.projectIdOrName}</span>
          {data.hiddenProductionEnvCount ? (
            <> · {data.hiddenProductionEnvCount} additional production secrets hidden by Vercel</>
          ) : null}
        </p>
      )}

      {error && <p className="mb-4 rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

      <AdminAsync loading={loading} error={null}>
        <AdminDataTable
          columns={columns}
          rows={data?.envs ?? []}
          rowKey={(e) => e.id}
          emptyLabel="No environment variables found."
        />
      </AdminAsync>

      {creating && (
        <EnvFormModal
          title="Add environment variable"
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            void load();
          }}
        />
      )}

      {editing && (
        <EnvFormModal
          title={`Edit ${editing.key}`}
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
          onDeleted={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function EnvFormModal({
  title,
  initial,
  onClose,
  onSaved,
  onDeleted,
}: {
  title: string;
  initial?: EnvRow;
  onClose: () => void;
  onSaved: () => void;
  onDeleted?: () => void;
}) {
  const isEdit = Boolean(initial);
  const [key, setKey] = useState(initial?.key ?? "");
  const [value, setValue] = useState("");
  const [type, setType] = useState<"sensitive" | "encrypted" | "plain">(
    initial?.type === "plain" ? "plain" : "sensitive",
  );
  const [target, setTarget] = useState<string[]>(
    initial?.target?.length ? [...initial.target] : ["production", "preview", "development"],
  );
  const [comment, setComment] = useState(initial?.comment ?? "");
  const [reason, setReason] = useState("");
  const [confirmKey, setConfirmKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDelete, setShowDelete] = useState(false);

  const toggleTarget = (t: string) => {
    setTarget((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const headers = await authHeaders();
      if (isEdit && initial) {
        const body: Record<string, unknown> = { reason };
        if (value) body.value = value;
        if (key !== initial.key) body.key = key;
        body.type = type;
        body.target = target;
        body.comment = comment;
        const res = await fetch(`/api/admin/vercel/env/${initial.id}`, {
          method: "PATCH",
          headers,
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "Save failed.");
      } else {
        if (!value) throw new Error("Value is required for new variables.");
        const res = await fetch("/api/admin/vercel/env", {
          method: "POST",
          headers,
          body: JSON.stringify({ key, value, type, target, comment, reason }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "Create failed.");
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!initial || !onDeleted) return;
    setBusy(true);
    setError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/admin/vercel/env/${initial.id}`, {
        method: "DELETE",
        headers,
        body: JSON.stringify({ reason, confirmKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Delete failed.");
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setBusy(false);
    }
  };

  const isProtected = initial && ["VERCEL_API_TOKEN", "VERCEL_ACCESS_TOKEN", "SUPABASE_SECRET_KEY", "PLATFORM_SUPER_ADMIN_EMAIL", "REVOLUT_MERCHANT_API_KEY", "REVOLUT_WEBHOOK_SECRET"].includes(initial.key);

  return (
    <Modal open onClose={onClose} size="lg">
      <ModalHeader title={title} onClose={onClose} icon={<KeyRound className="h-5 w-5" />} />
      <div className="max-h-[70vh] space-y-4 overflow-y-auto px-6 py-5">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-ink-3">Key</span>
          <input
            className="input-field font-mono uppercase"
            value={key}
            onChange={(e) => setKey(e.target.value.toUpperCase())}
            disabled={isEdit && initial?.system}
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-ink-3">
            {isEdit ? "New value (leave blank to keep current)" : "Value"}
          </span>
          <input
            type="password"
            autoComplete="new-password"
            className="input-field font-mono"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={isEdit ? "••••••••" : ""}
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-3">Type</span>
            <select className="input-field" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              <option value="sensitive">Sensitive (recommended)</option>
              <option value="encrypted">Encrypted</option>
              <option value="plain">Plain</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-3">Comment</span>
            <input className="input-field" value={comment} onChange={(e) => setComment(e.target.value)} />
          </label>
        </div>

        <div>
          <span className="mb-1.5 block text-xs font-medium text-ink-3">Environments</span>
          <div className="flex flex-wrap gap-2">
            {TARGETS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => toggleTarget(t)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                  target.includes(t)
                    ? "border-accent bg-accent-soft text-accent-d"
                    : "border-border-2 text-ink-3"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {key.startsWith("NEXT_PUBLIC_") && (
          <p className="text-xs text-amber-700">
            NEXT_PUBLIC_ variables are exposed to the browser — never put secrets here.
          </p>
        )}

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-ink-3">Reason (required, audited)</span>
          <input
            className="input-field"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Rotating SiliconFlow API key"
          />
        </label>

        {showDelete && isEdit && (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-4">
            <p className="text-sm font-medium text-danger">Delete this variable?</p>
            {isProtected && (
              <label className="mt-2 block">
                <span className="mb-1 block text-xs text-ink-3">
                  Type <span className="font-mono">{initial?.key}</span> to confirm
                </span>
                <input className="input-field font-mono" value={confirmKey} onChange={(e) => setConfirmKey(e.target.value)} />
              </label>
            )}
            <Button variant="danger" size="sm" className="mt-3" onClick={remove} disabled={busy}>
              Confirm delete
            </Button>
          </div>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
      <div className="flex justify-between gap-2 border-t border-border-2 px-6 py-4">
        {isEdit && onDeleted ? (
          <Button variant="danger" size="sm" onClick={() => setShowDelete(true)} disabled={busy || showDelete}>
            Delete
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy || !reason.trim()}>
            {busy ? "Saving…" : isEdit ? "Save changes" : "Create"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
