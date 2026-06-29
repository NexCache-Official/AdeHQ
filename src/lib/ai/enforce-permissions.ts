import type { AIEmployee, EmployeeResponseEffect } from "@/lib/types";

export function enforceEmployeePermissions(
  employee: AIEmployee,
  effect: EmployeeResponseEffect,
): EmployeeResponseEffect {
  const next: EmployeeResponseEffect = {
    workLog: [...effect.workLog],
    tasks: [...effect.tasks],
    memory: [...effect.memory],
    approvals: [...effect.approvals],
    emailDrafts: effect.emailDrafts ? [...effect.emailDrafts] : undefined,
    statusChange: effect.statusChange,
    handoffTo: effect.handoffTo,
    currentTask: effect.currentTask,
  };

  if (!employee.permissions.createTasks && next.tasks.length > 0) {
    next.tasks = [];
    next.workLog.push({
      action: "Permission blocked",
      summary: "Task creation blocked by employee permissions.",
      status: "failed",
    });
  }

  if (!employee.permissions.writeDraftMemory && next.memory.length > 0) {
    next.memory = [];
    next.workLog.push({
      action: "Permission blocked",
      summary: "Memory write blocked by employee permissions.",
      status: "failed",
    });
  }

  if (!employee.permissions.requestApproval && next.approvals.length > 0) {
    next.approvals = [];
    next.workLog.push({
      action: "Permission blocked",
      summary: "Approval requests blocked by employee permissions.",
      status: "failed",
    });
  }

  if (!employee.permissions.messageEmployees && next.handoffTo?.length) {
    next.workLog.push({
      action: "Handoff suggested",
      summary: `Suggested handoff to ${next.handoffTo.join(", ")} (requires human to continue).`,
      status: "success",
    });
  }

  return next;
}
