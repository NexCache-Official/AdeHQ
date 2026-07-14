"use client";

import { useEffect, useMemo, useState } from "react";
import type { AIEmployee, EmployeePermissions } from "@/lib/types";
import { WORKFORCE_CALLS_ENABLED } from "@/lib/config/features";
import { Button, Toggle } from "@/components/ui";
import { cn } from "@/lib/utils";
import { Shield } from "lucide-react";

export const EMPLOYEE_PERMISSION_LABELS: {
  key: keyof EmployeePermissions;
  label: string;
  hint?: string;
}[] = [
  { key: "readMemory", label: "Read project memory" },
  { key: "writeDraftMemory", label: "Write draft memory" },
  { key: "pinMemory", label: "Pin memory" },
  { key: "createTasks", label: "Create tasks" },
  { key: "assignTasks", label: "Assign tasks" },
  { key: "messageEmployees", label: "Message other AI employees" },
  {
    key: "startCalls",
    label: WORKFORCE_CALLS_ENABLED ? "Start calls" : "Start calls (coming soon)",
  },
  { key: "requestApproval", label: "Request human approval" },
  {
    key: "approvalBeforeExternal",
    label: "Approval before external actions",
    hint: "Gate",
  },
  {
    key: "approvalBeforeEmails",
    label: "Approval before sending emails",
    hint: "Gate",
  },
  {
    key: "approvalBeforeCode",
    label: "Approval before changing code",
    hint: "Gate",
  },
  {
    key: "approvalBeforeBilling",
    label: "Approval before billing tools",
    hint: "Gate",
  },
];

type Props = {
  employee: AIEmployee;
  disabled?: boolean;
  onSave: (permissions: EmployeePermissions) => void | Promise<void>;
};

export function EmployeePermissionsPanel({ employee, disabled, onSave }: Props) {
  const [draft, setDraft] = useState<EmployeePermissions>(employee.permissions);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageIsError, setMessageIsError] = useState(false);

  useEffect(() => {
    setDraft(employee.permissions);
  }, [employee.id, employee.permissions]);

  const dirty = useMemo(() => {
    return EMPLOYEE_PERMISSION_LABELS.some(
      (item) => draft[item.key] !== employee.permissions[item.key],
    );
  }, [draft, employee.permissions]);

  const setKey = (key: keyof EmployeePermissions, value: boolean) => {
    if (key === "startCalls" && !WORKFORCE_CALLS_ENABLED) return;
    setDraft((prev) => ({ ...prev, [key]: value }));
    setMessage(null);
    setMessageIsError(false);
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    setMessageIsError(false);
    try {
      const next = {
        ...draft,
        startCalls: WORKFORCE_CALLS_ENABLED ? draft.startCalls : false,
      };
      await onSave(next);
      setMessage("Permissions saved.");
    } catch (error) {
      setMessageIsError(true);
      setMessage(error instanceof Error ? error.message : "Could not save permissions.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Shield className="h-4 w-4 text-accent" />
          Permissions
        </h2>
        <p className="mt-0.5 text-xs text-ink-3">
          What this employee is allowed to do. Changes apply on the next turn.
        </p>
      </div>

      <div className="space-y-1">
        {EMPLOYEE_PERMISSION_LABELS.map((item) => {
          const callsDisabled = item.key === "startCalls" && !WORKFORCE_CALLS_ENABLED;
          const checked = callsDisabled ? false : draft[item.key];
          return (
            <label
              key={item.key}
              className={cn(
                "flex items-center justify-between gap-3 rounded-lg px-2 py-2 transition",
                !disabled && !callsDisabled && "hover:bg-muted/80",
                (disabled || callsDisabled) && "opacity-60",
              )}
            >
              <span className="min-w-0">
                <span className="block text-sm text-ink-2">{item.label}</span>
                {item.hint && (
                  <span className="text-[10px] font-medium uppercase tracking-wide text-ink-3">
                    {item.hint}
                  </span>
                )}
              </span>
              <Toggle
                checked={checked}
                disabled={disabled || saving || callsDisabled}
                onChange={(value) => setKey(item.key, value)}
              />
            </label>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          disabled={!dirty || disabled || saving}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save permissions"}
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
    </section>
  );
}
