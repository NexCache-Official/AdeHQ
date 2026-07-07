"use client";

import { useEffect, useState } from "react";
import { Modal, ModalHeader, Button } from "@/components/ui";
import { AutonomousSessionPanel } from "./AutonomousSessionPanel";
import { startAutonomousSession, type SessionPayload } from "@/lib/autonomy/client";
import { EmployeeAvatar } from "@/components/EmployeeAvatar";
import type { AIEmployee } from "@/lib/types";
import { Bot, Loader2, Sparkles } from "lucide-react";

const BUDGETS = [4, 6, 8, 12, 16, 20];
type StepBudgetSelection = "workspace" | number;

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
  const [objective, setObjective] = useState(defaultObjective);
  const [employeeId, setEmployeeId] = useState(defaultEmployeeId ?? employees[0]?.id ?? "");
  const [stepBudget, setStepBudget] = useState<StepBudgetSelection>("workspace");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<SessionPayload | null>(null);

  const firstEmployeeId = employees[0]?.id ?? "";
  const canStart = objective.trim().length > 3 && employeeId && workspaceId;
  const employee = employees.find((e) => e.id === employeeId);

  useEffect(() => {
    if (!open) return;
    setObjective(defaultObjective);
    setEmployeeId(defaultEmployeeId ?? firstEmployeeId);
    setStepBudget("workspace");
    setError(null);
    setPayload(null);
  }, [open, defaultObjective, defaultEmployeeId, firstEmployeeId]);

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
      setError(e instanceof Error ? e.message : "Could not start autopilot.");
    } finally {
      setStarting(false);
    }
  };

  const reset = () => { setPayload(null); onClose(); };

  return (
    <Modal open={open} onClose={reset} size="lg">
      <ModalHeader
        title={payload ? "Autopilot" : "Run autonomously"}
        subtitle={payload ? undefined : "Give an employee an objective and watch it work — with approvals and a hard stop."}
        onClose={reset}
        icon={<Bot className="h-5 w-5" />}
      />

      {payload ? (
        <div className="p-4">
          <AutonomousSessionPanel sessionId={payload.session.id} initial={payload} />
          <div className="mt-3 flex justify-end">
            <Button variant="ghost" onClick={reset}>Close</Button>
          </div>
        </div>
      ) : (
        <>
          <div className="space-y-4 p-5">
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

            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-ink-3">Employee</span>
                <select className="input-field" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>{e.name} · {e.role}</option>
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
                    <option key={b} value={b}>{b} steps</option>
                  ))}
                </select>
              </label>
            </div>

            {employee && (
              <div className="flex items-center gap-2.5 rounded-xl border border-border bg-muted/40 px-3 py-2.5">
                <EmployeeAvatar employee={employee} size="sm" showStatus={false} />
                <div className="text-xs text-ink-2">
                  <span className="font-semibold text-ink">{employee.name}</span> will plan and execute this autonomously, pausing for your approval on anything risky.
                </div>
              </div>
            )}

            {error && <p className="text-xs font-medium text-rose-600">{error}</p>}
          </div>

          <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
            <Button variant="ghost" onClick={reset}>Cancel</Button>
            <Button onClick={start} disabled={!canStart || starting}>
              {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Launch autopilot
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
