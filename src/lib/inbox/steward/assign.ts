/**
 * Employee eligibility + suggest vs auto-assign (never fans email body to roster).
 * Assignment never starts a model.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssignmentSource, EmailCategory, EmailTriageResult } from "./types";
import { DEFAULT_ASSIGN_THRESHOLD } from "./types";

export type StewardEmployee = {
  id: string;
  name: string;
  roleTitle: string;
  roleKey: string;
  expertiseSummary: string;
};

const CATEGORY_ROLE_HINTS: Record<EmailCategory, string[]> = {
  sales: ["sales", "account", "bd", "revenue", "commercial"],
  support: ["support", "customer", "success", "helpdesk", "service"],
  billing: ["billing", "finance", "accounts", "ops"],
  partnership: ["partner", "business development", "alliance"],
  investor: ["investor", "fundraising", "ceo", "founder"],
  recruiting: ["recruit", "talent", "people", "hr", "hiring"],
  operations: ["operations", "ops", "coo"],
  automated: [],
  newsletter: [],
  security: ["security", "compliance", "legal"],
  general: ["assistant", "ops", "general", "maya"],
};

export async function loadEligibleEmployees(
  client: SupabaseClient,
  workspaceId: string,
): Promise<StewardEmployee[]> {
  const { data, error } = await client
    .from("ai_employees")
    .select("id, name, role, role_key, instructions, status")
    .eq("workspace_id", workspaceId)
    .eq("status", "active");
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name ?? "Employee"),
    roleTitle: String(row.role ?? ""),
    roleKey: String(row.role_key ?? ""),
    expertiseSummary: String(row.instructions ?? "").slice(0, 500),
  }));
}

/** Score employees from role metadata only — never send email body. */
export function scoreEmployeesForCategory(
  employees: StewardEmployee[],
  category: EmailCategory,
): Array<{ employee: StewardEmployee; score: number; reason: string }> {
  const hints = CATEGORY_ROLE_HINTS[category] ?? [];
  if (hints.length === 0 || employees.length === 0) return [];

  return employees
    .map((employee) => {
      const hay = `${employee.roleKey} ${employee.roleTitle} ${employee.expertiseSummary}`.toLowerCase();
      let hits = 0;
      for (const hint of hints) {
        if (hay.includes(hint)) hits += 1;
      }
      // Strong multi-hint matches can reach assign_threshold (default 0.90).
      const score = hits === 0 ? 0 : Math.min(0.95, 0.5 + hits * 0.2);
      return {
        employee,
        score,
        reason: hits > 0 ? `Best match for ${category} enquiries` : "",
      };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
}

export type AssignmentDecision = {
  suggestedEmployeeId?: string;
  assignedEmployeeId?: string;
  assignmentConfidence: number;
  assignmentSource?: AssignmentSource;
  matchReason?: string;
};

/**
 * Apply suggest-vs-assign policy. Continuity / high deterministic → assign.
 * Role match below threshold → suggest only.
 */
export function decideAssignment(params: {
  triage: EmailTriageResult;
  existingEmployeeId: string | null;
  employees: StewardEmployee[];
  assignThreshold?: number;
}): AssignmentDecision {
  const threshold = params.assignThreshold ?? DEFAULT_ASSIGN_THRESHOLD;

  // Thread continuity — auto-assign if employee still eligible.
  if (params.existingEmployeeId) {
    const still = params.employees.find((e) => e.id === params.existingEmployeeId);
    if (still) {
      return {
        suggestedEmployeeId: still.id,
        assignedEmployeeId: still.id,
        assignmentConfidence: 0.99,
        assignmentSource: "thread_continuity",
        matchReason: "Continuing previous owner on this thread",
      };
    }
  }

  // Skip ownership for pure automated mail.
  if (
    params.triage.automationType === "newsletter" ||
    params.triage.automationType === "bounce" ||
    params.triage.automationType === "receipt" ||
    params.triage.automationType === "notification"
  ) {
    return { assignmentConfidence: 0 };
  }

  const ranked = scoreEmployeesForCategory(params.employees, params.triage.category);
  const top = ranked[0];
  if (!top) return { assignmentConfidence: 0 };

  if (top.score >= threshold) {
    return {
      suggestedEmployeeId: top.employee.id,
      assignedEmployeeId: top.employee.id,
      assignmentConfidence: top.score,
      assignmentSource: "deterministic_rule",
      matchReason: top.reason,
    };
  }

  return {
    suggestedEmployeeId: top.employee.id,
    assignmentConfidence: top.score,
    assignmentSource: "role_match",
    matchReason: top.reason,
  };
}

export async function assertEmployeeEligible(
  client: SupabaseClient,
  params: { workspaceId: string; employeeId: string },
): Promise<StewardEmployee> {
  const list = await loadEligibleEmployees(client, params.workspaceId);
  const found = list.find((e) => e.id === params.employeeId);
  if (!found) {
    throw new Error("Employee is not active or cannot access this mailbox.");
  }
  return found;
}
