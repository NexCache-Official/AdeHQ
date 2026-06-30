import { defaultModelModeForRole } from "@/lib/ai/model-catalog";
import { DEFAULT_SILICONFLOW_MODEL } from "@/lib/config/features";
import { ROLE_TEMPLATES, TOOL_CATALOG, defaultPermissions } from "@/lib/demo";
import type { DemoApplicant, JobBrief } from "./types";
import type { AIEmployee, EmployeeRoleKey } from "@/lib/types";
import { briefToInstructions } from "./build-brief";
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

const CANDIDATE_MODEL_MODE: Record<string, "cheap" | "balanced" | "strong"> = {
  nova: "cheap",
  eleanor: "balanced",
  marcus: "strong",
};

const CANDIDATE_ACCENT: Record<string, string> = {
  nova: "#f97316",
  eleanor: "#6366f1",
  marcus: "#7c3aed",
};

export function departmentToRoleKey(departmentId?: string | null): EmployeeRoleKey {
  if (!departmentId) return "pm";
  return DEPT_ROLE_KEY[departmentId] ?? "pm";
}

export function candidateToEmployee(
  candidate: DemoApplicant,
  brief: JobBrief,
  departmentId: string | null,
  defaultRoomId?: string,
): AIEmployee {
  const roleKey = departmentToRoleKey(departmentId);
  const template = ROLE_TEMPLATES.find((t) => t.key === roleKey) ?? ROLE_TEMPLATES[0];
  const modelMode = CANDIDATE_MODEL_MODE[candidate.id] ?? defaultModelModeForRole(roleKey);
  const timestamp = nowISO();

  return {
    id: uid("emp"),
    name: candidate.name,
    role: brief.roleTitle || template.role,
    roleKey,
    provider: "siliconflow",
    model: DEFAULT_SILICONFLOW_MODEL,
    modelMode,
    seniority: candidate.quality >= 3 ? "Principal" : candidate.quality >= 2 ? "Senior" : "Mid",
    status: "idle",
    instructions: briefToInstructions(brief),
    communicationStyle: brief.communicationStyle,
    successCriteria: brief.successCriteria.join("; "),
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
    avgResponseTime: candidate.speedText,
    trustScore: candidate.quality >= 3 ? 92 : candidate.quality >= 2 ? 84 : 76,
    accent: CANDIDATE_ACCENT[candidate.id] ?? template.accent,
    defaultRoomId,
    lastActiveAt: timestamp,
    createdAt: timestamp,
  };
}
