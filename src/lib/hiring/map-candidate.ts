import { ROLE_TEMPLATES, TOOL_CATALOG, defaultPermissions } from "@/lib/demo";
import type { AiEmployeeApplicant, AiEmployeeJobBrief } from "./types";
import type { AIEmployee, EmployeeRoleKey } from "@/lib/types";
import { briefToInstructions } from "./build-brief";
import { getRoleByKey, legacyDepartmentIdForRole } from "./role-library";
import { nowISO, uid } from "@/lib/utils";

const DEPT_ROLE_KEY: Record<string, EmployeeRoleKey> = {
  product: "pm",
  engineering: "engineering",
  design: "design",
  research: "research",
  marketing: "marketing",
  sales: "sales",
  support: "support",
  operations: "operations",
  finance: "marketing",
  legal: "operations",
  hr: "operations",
  pr: "marketing",
  gamedev: "gamedev",
  custom: "pm",
};

const CANDIDATE_ACCENT: Record<string, string> = {
  high_capacity: "#f97316",
  recommended: "#6366f1",
  premium: "#7c3aed",
};

export function departmentToRoleKey(departmentId?: string | null): EmployeeRoleKey {
  if (!departmentId) return "pm";
  return DEPT_ROLE_KEY[departmentId] ?? "pm";
}

export function hiringRoleToEmployeeRoleKey(
  roleKey?: string | null,
  departmentId?: string | null,
): EmployeeRoleKey {
  const libraryRole = getRoleByKey(roleKey ?? undefined);
  if (libraryRole) return libraryRole.employeeRoleKey;
  return departmentToRoleKey(departmentId ?? legacyDepartmentIdForRole(roleKey));
}

export function candidateToEmployee(
  candidate: AiEmployeeApplicant,
  brief: AiEmployeeJobBrief,
  departmentId: string | null,
  roleKey?: string | null,
): AIEmployee {
  const employeeRoleKey = hiringRoleToEmployeeRoleKey(roleKey, departmentId);
  const template = ROLE_TEMPLATES.find((t) => t.key === employeeRoleKey) ?? ROLE_TEMPLATES[0];
  const timestamp = nowISO();

  return {
    id: uid("emp"),
    name: candidate.name,
    role: brief.roleTitle || template.role,
    roleKey: employeeRoleKey,
    provider: "siliconflow",
    model: candidate.resolvedModelId,
    modelMode: candidate.modelMode,
    seniority:
      candidate.quality === "premium"
        ? "Principal"
        : candidate.quality === "high"
          ? "Senior"
          : "Mid",
    status: "idle",
    instructions: briefToInstructions(brief),
    communicationStyle: brief.communicationStyle,
    successCriteria: brief.successMetrics.join("; "),
    tools: template.suggestedTools.map((toolId) => {
      const meta = TOOL_CATALOG.find((t) => t.id === toolId)!;
      return {
        toolId,
        name: meta.name,
        category: meta.category,
        status: meta.status === "not_connected" ? ("not_connected" as const) : meta.status,
        permission: "read" as const,
      };
    }),
    permissions: {
      ...defaultPermissions(),
      approvalBeforeExternal: true,
      approvalBeforeEmails: true,
    },
    memoryCount: 0,
    tasksCompleted: 0,
    messagesSent: 0,
    approvalsRequested: 0,
    avgResponseTime: candidate.speed,
    trustScore: candidate.qualityLevel >= 3 ? 92 : candidate.qualityLevel >= 2 ? 84 : 76,
    accent: CANDIDATE_ACCENT[candidate.tier] ?? template.accent,
    defaultRoomId: undefined,
    lastActiveAt: timestamp,
    createdAt: timestamp,
  };
}
