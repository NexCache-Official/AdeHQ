"use client";

import { useMemo, useState } from "react";
import type { AIEmployee } from "@/lib/types";
import type { CapabilityDomain } from "@/lib/integrations/types";
import {
  applyEmployeeCapabilityToggles,
  listEmployeeCapabilityToggles,
} from "@/lib/integrations/employee-capabilities";
import { cn } from "@/lib/utils";
import { Sparkles, Wrench } from "lucide-react";

type Props = {
  employee: AIEmployee;
  workspaceId: string;
  backend: "demo" | "supabase";
  disabled?: boolean;
  onSave: (employee: AIEmployee) => void | Promise<void>;
};

export function EmployeeCapabilitiesPanel({
  employee,
  workspaceId,
  backend,
  disabled,
  onSave,
}: Props) {
  const toggles = useMemo(() => listEmployeeCapabilityToggles(employee), [employee]);
  const [draft, setDraft] = useState<Set<CapabilityDomain>>(
    () => new Set(toggles.filter((t) => t.enabled).map((t) => t.domain)),
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const dirty = useMemo(() => {
    const current = new Set(toggles.filter((t) => t.enabled).map((t) => t.domain));
    if (current.size !== draft.size) return true;
    for (const d of current) if (!draft.has(d)) return true;
    return false;
  }, [toggles, draft]);

  const toggle = (domain: CapabilityDomain) => {
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      return next;
    });
    setMessage(null);
  };

  const applySuggested = () => {
    setDraft(new Set(toggles.filter((t) => t.suggested).map((t) => t.domain)));
    setMessage(null);
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const updated = applyEmployeeCapabilityToggles(employee, [...draft]);
      if (backend === "supabase" && workspaceId) {
        const res = await fetch(`/api/workforce/${employee.id}/capabilities`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            workspaceId,
            enabledDomains: [...draft],
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? "Could not save capabilities.");
        }
        const payload = (await res.json()) as { capabilities?: unknown };
        void payload;
      }
      await onSave(updated);
      setMessage("Capabilities updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save capabilities.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Wrench className="h-4 w-4 text-accent" />
            Tools & capabilities
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Control what this employee can do inside AdeHQ. Maya suggests defaults at hire — you can
            change them anytime.
          </p>
        </div>
        <button
          type="button"
          disabled={disabled || saving}
          onClick={applySuggested}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-ink-2 hover:bg-muted disabled:opacity-50"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Apply role suggestions
        </button>
      </div>

      <div className="grid gap-2">
        {toggles.map((item) => {
          const on = draft.has(item.domain);
          return (
            <label
              key={item.domain}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition",
                on ? "border-accent/30 bg-accent-soft/20" : "border-slate-200 bg-slate-50",
                disabled && "cursor-not-allowed opacity-60",
              )}
            >
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-slate-300 accent-accent"
                checked={on}
                disabled={disabled || saving}
                onChange={() => toggle(item.domain)}
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-slate-900">{item.label}</span>
                  {item.suggested && (
                    <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold text-accent">
                      Suggested
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-xs text-slate-500">{item.description}</span>
              </span>
            </label>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!dirty || disabled || saving}
          onClick={() => void save()}
          className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save capabilities"}
        </button>
        {message && <span className="text-xs text-slate-500">{message}</span>}
      </div>
    </div>
  );
}
