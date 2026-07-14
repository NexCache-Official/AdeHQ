"use client";

import { useEffect, useMemo, useState } from "react";
import type { AIEmployee } from "@/lib/types";
import type { CapabilityDomain } from "@/lib/integrations/types";
import {
  applyEmployeeCapabilityToggles,
  listEmployeeCapabilityToggles,
} from "@/lib/integrations/employee-capabilities";
import { cn } from "@/lib/utils";
import { authHeaders } from "@/lib/api/auth-client";
import { Button } from "@/components/ui";
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
  const [messageIsError, setMessageIsError] = useState(false);

  useEffect(() => {
    setDraft(new Set(toggles.filter((t) => t.enabled).map((t) => t.domain)));
  }, [toggles]);

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
    setMessageIsError(false);
  };

  const applySuggested = () => {
    setDraft(new Set(toggles.filter((t) => t.suggested).map((t) => t.domain)));
    setMessage(null);
    setMessageIsError(false);
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    setMessageIsError(false);
    try {
      const updated = applyEmployeeCapabilityToggles(employee, [...draft]);
      if (backend === "supabase" && workspaceId) {
        const headers = {
          "Content-Type": "application/json",
          ...(await authHeaders()),
        };
        const res = await fetch(`/api/workforce/${employee.id}/capabilities`, {
          method: "PATCH",
          headers,
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
      setMessageIsError(true);
      setMessage(error instanceof Error ? error.message : "Could not save capabilities.");
    } finally {
      setSaving(false);
    }
  };

  const activeGrants = toggles.filter((t) => draft.has(t.domain));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Wrench className="h-4 w-4 text-accent" />
            Tools & capabilities
          </h2>
          <p className="mt-0.5 max-w-xl text-xs text-ink-3">
            New hires start with every AdeHQ tool on. Turn off what they shouldn&apos;t use — if they
            need something later, they&apos;ll ask in chat for Allow once or Always allow. Email here
            means draft artifacts inside AdeHQ, not Gmail or inbox send.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={disabled || saving}
          onClick={applySuggested}
        >
          <Sparkles className="h-3.5 w-3.5" />
          Apply role suggestions
        </Button>
      </div>

      <div className="grid gap-2">
        {toggles.map((item) => {
          const on = draft.has(item.domain);
          return (
            <label
              key={item.domain}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 transition",
                on ? "border-accent/35 bg-accent-soft/25" : "border-border bg-muted/40",
                disabled && "cursor-not-allowed opacity-60",
              )}
            >
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-border accent-accent"
                checked={on}
                disabled={disabled || saving}
                onChange={() => toggle(item.domain)}
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-ink">{item.label}</span>
                  {item.suggested && (
                    <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent-d">
                      Suggested
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-ink-3">
                  {item.description}
                </span>
              </span>
            </label>
          );
        })}
      </div>

      {activeGrants.length > 0 && (
        <div className="rounded-xl border border-border bg-muted/30 px-3.5 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
            Active grants ({activeGrants.length})
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-2">
            {activeGrants.map((g) => g.label).join(" · ")}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="sm"
          disabled={!dirty || disabled || saving}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save capabilities"}
        </Button>
        {message && (
          <span
            className={cn(
              "text-xs font-medium",
              messageIsError ? "text-rose-600" : "text-emerald-700",
            )}
          >
            {message}
          </span>
        )}
      </div>
    </div>
  );
}
