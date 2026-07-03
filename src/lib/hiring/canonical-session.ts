import type { AiEmployeeJobBrief, HiringSessionState } from "./types";
import { initialHiringSession } from "./session";
import { legacyDepartmentIdForRole } from "./role-library";

/** Where a hiring session was started */
export type HiringSessionSource =
  | "onboarding"
  | "top_nav_hire_button"
  | "maya_direct_chat"
  | "maya_hiring_topic"
  | "hire_route";

export type HiringSessionStatus =
  | "proposed"
  | "active"
  | "candidates_ready"
  | "hired"
  | "cancelled"
  | "archived";

export const ACTIVE_HIRING_STATUSES: HiringSessionStatus[] = [
  "proposed",
  "active",
  "candidates_ready",
];

export type HiringSessionScope = {
  mayaRoomId: string;
  /** Dedicated hiring topic id — scopes session to one role/workflow */
  mayaTopicId?: string | null;
  /** Hiring in Maya Direct Chat without creating a topic */
  directChat?: boolean;
  /** /hire page and onboarding flows */
  hireRoute?: boolean;
  source?: HiringSessionSource;
};

export type CanonicalHiringSessionMeta = {
  sessionId?: string | null;
  source: HiringSessionSource;
  status: HiringSessionStatus;
  hiringTopicId?: string | null;
  roleTitle?: string | null;
  roleKey?: string | null;
  department?: string | null;
  readinessScore?: number | null;
  requiredQuestionsAnswered?: number;
  selectedCandidateId?: string | null;
  createdFromMessageId?: string | null;
  lastUserMessageId?: string | null;
};

export function hiringSessionStorageKey(scope: HiringSessionScope): string {
  if (scope.mayaTopicId && !scope.directChat && !scope.hireRoute) {
    return `adehq-hiring-session:topic:${scope.mayaTopicId}`;
  }
  if (scope.hireRoute) {
    return `adehq-hiring-session:hire-route`;
  }
  if (scope.directChat) {
    return `adehq-hiring-session:direct:${scope.mayaRoomId}`;
  }
  return `adehq-hiring-session:room:${scope.mayaRoomId}`;
}

export function deriveSessionStatus(state: HiringSessionState): HiringSessionStatus {
  if (state.hiredEmployeeId) return "hired";
  if (state.candidates.length > 0) return "candidates_ready";
  if (state.recruiterMessages.length > 0 || state.roleInput.trim()) return "active";
  return "proposed";
}

export function roleSnapshotFromState(state: HiringSessionState): {
  roleKey: string | null;
  roleTitle: string | null;
  department: string | null;
} {
  return {
    roleKey: state.roleKey,
    roleTitle:
      state.brief?.roleTitle ??
      state.briefPartial?.roleTitle ??
      state.customRoleTitle ??
      (state.roleInput.trim() || null),
    department: state.departmentId ?? state.brief?.department ?? null,
  };
}

export function candidatesMatchRole(
  candidates: HiringSessionState["candidates"],
  roleKey: string | null | undefined,
  roleTitle: string | null | undefined,
): boolean {
  if (candidates.length === 0) return true;
  const first = candidates[0] as { roleKey?: string; roleTitle?: string };
  if (roleKey && first.roleKey && first.roleKey !== roleKey) return false;
  if (roleTitle && first.roleTitle && first.roleTitle !== roleTitle) return false;
  return true;
}

export function bootstrapStateFromTopicRole(params: {
  roleTitle: string;
  roleKey: string | null;
  topicId: string;
}): HiringSessionState {
  return {
    ...initialHiringSession(),
    step: "recruiter",
    roleInput: params.roleTitle,
    roleKey: params.roleKey,
    customRoleTitle: params.roleKey === "custom" ? params.roleTitle : null,
    departmentId: legacyDepartmentIdForRole(params.roleKey),
    sessionSource: "maya_hiring_topic",
    hiringTopicId: params.topicId,
    inferenceConfidence: params.roleKey ? "high" : "medium",
    suggestedRoleKeys: params.roleKey ? [params.roleKey] : [],
    roleSetAt: new Date().toISOString(),
  };
}

export function briefRoleKey(brief?: AiEmployeeJobBrief | Partial<AiEmployeeJobBrief>): string | null {
  return brief?.roleTitle?.toLowerCase().replace(/\s+/g, "_") ?? null;
}
