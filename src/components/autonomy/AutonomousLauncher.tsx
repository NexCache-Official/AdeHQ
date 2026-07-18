"use client";

import { useEffect, useMemo, useState } from "react";
import { Modal, ModalHeader, Button } from "@/components/ui";
import { AutonomousSessionPanel } from "./AutonomousSessionPanel";
import { startAutonomousSession, type SessionPayload } from "@/lib/autonomy/client";
import { EmployeeAvatar } from "@/components/EmployeeAvatar";
import { isWorkAssignableEmployee } from "@/lib/maya-employee";
import type { AIEmployee } from "@/lib/types";
import { Bot, Loader2, Sparkles } from "lucide-react";

const BUDGETS = [4, 6, 8, 12, 16, 20];
type StepBudgetSelection = "workspace" | number;

function friendlyStartError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const lower = raw.toLowerCase();
  if (
    lower.includes("ai_runtime_v2") ||
    lower.includes("runtime v2") ||
    lower.includes("maya") ||
    lower.includes("workforce manager")
  ) {
    return "Autopilot is for hired AI employees — pick someone from your workforce, or try again in a moment.";
  }
  if (raw.trim()) return raw;
  return "Couldn't start autopilot. Try again in a moment.";
}

export function AutonomousLauncher({
  open,
  onClose,
  workspaceId,
  employees,
  defaultObjective = "",
  defaultEmployeeId,
  roomId,
  topicId,
  taskId,
  onStarted,
}: {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  employees: AIEmployee[];
  defaultObjective?: string;
  defaultEmployeeId?: string;
  roomId?: string;
  topicId?: string;
  taskId?: string;
  onStarted?: (payload: SessionPayload) => void;
}) {
  const launchableEmployees = useMemo(
    () => employees.filter(isWorkAssignableEmployee),
    [employees],
  );
  const [objective, setObjective] = useState(defaultObjective);
  const [employeeId, setEmployeeId] = useState(
    defaultEmployeeId && launchableEmployees.some((e) => e.id === defaultEmployeeId)
      ? defaultEmployeeId
      : (launchableEmployees[0]?.id ?? ""),
  );
  const [stepBudget, setStepBudget] = useState<StepBudgetSelection>("workspace");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<SessionPayload | null>(null);

  const firstEmployeeId = launchableEmployees[0]?.id ?? "";
  const canStart = objective.trim().length > 3 && employeeId && workspaceId;
  const employee = launchableEmployees.find((e) => e.id === employeeId);

  useEffect(() => {
    if (!open) return;
    setObjective(defaultObjective);
    const preferred =
      defaultEmployeeId && launchableEmployees.some((e) => e.id === defaultEmployeeId)
        ? defaultEmployeeId
        : firstEmployeeId;
    setEmployeeId(preferred);
    setStepBudget("workspace");
    setError(null);
    setPayload(null);
  }, [open, defaultObjective, defaultEmployeeId, firstEmployeeId, launchableEmployees]);

  const start = async () => {
    if (!canStart) return;
    setStarting(true);
    setError(null);
    try {
      const result = await startAutonomousSession({
        workspaceId,
        employeeId,
        objective: objective.trim(),
        roomId,
        topicId,
        taskId,
        stepBudget: typeof stepBudget === "number" ? stepBudget : undefined,
      });
      setPayload(result);
      onStarted?.(result);
    } catch (e) {
      setError(friendlyStartError(e));
      if (e instanceof Error) console.warn("[AdeHQ autonomy launcher]", e.message);
    } finally {
      setStarting(false);
    }
  };

  const reset = () => {
    setPayload(null);
    onClose();
  };

  return (
    <Modal open={open} onClose={reset} size="lg">
      <ModalHeader
        title={payload ? "Autopilot" : "Run autonomously"}
        subtitle={
          payload
            ? undefined
            : "Give a hired AI employee an objective — they work with approvals and a hard stop."
        }
        onClose={reset}
        icon={<Bot className="h-5 w-5" />}
      />

      {payload ? (
        <div className="p-4">
          <AutonomousSessionPanel sessionId={payload.session.id} initial={payload} onClose={reset} />
        </div>
      ) : (
        <>
          <div className="space-y-5 p-5">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-ink-3">Objective</span>
              <textarea
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
                rows={3}
                autoFocus
                placeholder="e.g. Add our 5 target accounts to the CRM, draft intro emails, and create follow-up tasks."
                className="w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm text-ink outline-none transition-all placeholder:text-ink-3 focus:border-accent focus:ring-2 focus:ring-accent-soft"
              />
            </label>

            {launchableEmployees.length === 0 ? (
              <p className="rounded-xl border border-border bg-muted/40 px-3.5 py-3 text-xs leading-relaxed text-ink-2">
                Hire an AI employee first — Autopilot runs on your workforce, not Maya.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-ink-3">Employee</span>
                  <select
                    className="input-field"
                    value={employeeId}
                    onChange={(e) => setEmployeeId(e.target.value)}
                  >
                    {launchableEmployees.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name} · {e.role}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-ink-3">Step budget</span>
                  <select
                    className="input-field"
                    value={stepBudget}
                    onChange={(e) =>
                      setStepBudget(e.target.value === "workspace" ? "workspace" : Number(e.target.value))
                    }
                  >
                    <option value="workspace">Workspace default</option>
                    {BUDGETS.map((b) => (
                      <option key={b} value={b}>
                        {b} steps
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}

            {employee && (
              <div className="flex items-center gap-2.5 rounded-xl border border-border bg-muted/40 px-3.5 py-3">
                <EmployeeAvatar employee={employee} size="sm" showStatus={false} />
                <div className="min-w-0 text-xs leading-relaxed text-ink-2">
                  <span className="font-semibold text-ink">{employee.name}</span> will plan and execute
                  this autonomously, pausing for your approval on anything risky.
                </div>
              </div>
            )}

            {error && <p className="text-xs leading-relaxed text-ink-2">{error}</p>}
          </div>

          <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
            <Button variant="ghost" onClick={reset}>
              Cancel
            </Button>
            <Button onClick={start} disabled={!canStart || starting || launchableEmployees.length === 0}>
              {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Launch autopilot
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
