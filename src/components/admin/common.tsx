"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { authHeaders } from "@/lib/api/auth-client";
import { Card } from "@/components/ui";
import { LoadingState } from "@/components/States";

// Data fetching ---------------------------------------------------------------

export function useAdminData<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!url) return;
    setLoading(true);
    setError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(url, { headers });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status}).`);
      setData(body as T);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, loading, error, refresh };
}

// Page header -------------------------------------------------------------------

export function AdminPageHeader({
  title,
  subtitle,
  icon,
  actions,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        {icon && (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
            {icon}
          </div>
        )}
        <div>
          <h1 className="text-xl font-semibold text-ink">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-ink-3">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

// Metric card -------------------------------------------------------------------

export function AdminMetricCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: "default" | "positive" | "warning" | "danger";
}) {
  const tones: Record<string, string> = {
    default: "text-ink",
    positive: "text-emerald-600",
    warning: "text-amber-600",
    danger: "text-danger",
  };
  return (
    <Card className="p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
        {label}
      </p>
      <p className={cn("mt-1.5 text-2xl font-semibold tabular-nums", tones[tone])}>
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-ink-3">{hint}</p>}
    </Card>
  );
}

// Health badge --------------------------------------------------------------------

export type HealthTone = "healthy" | "degraded" | "disabled" | "unknown";

export function AdminHealthBadge({ tone, label }: { tone: HealthTone; label?: string }) {
  const map: Record<HealthTone, { dot: string; text: string; cls: string }> = {
    healthy: { dot: "bg-emerald-500", text: "Healthy", cls: "bg-emerald-500/10 text-emerald-600" },
    degraded: { dot: "bg-amber-500", text: "Degraded", cls: "bg-amber-500/10 text-amber-600" },
    disabled: { dot: "bg-slate-400", text: "Disabled", cls: "bg-slate-400/10 text-ink-3" },
    unknown: { dot: "bg-slate-300", text: "Unknown", cls: "bg-slate-300/10 text-ink-3" },
  };
  const item = map[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        item.cls,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", item.dot)} />
      {label ?? item.text}
    </span>
  );
}

// Data table -------------------------------------------------------------------

export type AdminColumn<T> = {
  key: string;
  header: string;
  align?: "left" | "right";
  render: (row: T) => React.ReactNode;
};

export function AdminDataTable<T>({
  columns,
  rows,
  rowKey,
  emptyLabel = "No data.",
}: {
  columns: AdminColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  emptyLabel?: string;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border-2 text-[11px] uppercase tracking-[0.06em] text-ink-3">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    "px-4 py-3 font-semibold",
                    col.align === "right" && "text-right",
                  )}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-ink-3">
                  {emptyLabel}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  className="border-b border-border-2 last:border-0 hover:bg-muted/50"
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn(
                        "px-4 py-3 text-ink-2",
                        col.align === "right" && "text-right tabular-nums",
                      )}
                    >
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// Loading / error wrappers ------------------------------------------------------

export function AdminAsync({
  loading,
  error,
  children,
}: {
  loading: boolean;
  error: string | null;
  children: React.ReactNode;
}) {
  if (loading) return <LoadingState label="Loading…" />;
  if (error) {
    return (
      <Card className="p-6 text-center">
        <p className="text-sm text-danger">{error}</p>
      </Card>
    );
  }
  return <>{children}</>;
}

// Formatting helpers ------------------------------------------------------------

export function formatUsd(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "$0.00";
  if (value > 0 && value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

export function formatCount(value: number | null | undefined): string {
  return (value ?? 0).toLocaleString();
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatBytes(bytes: number | null | undefined): string {
  const value = bytes ?? 0;
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}
