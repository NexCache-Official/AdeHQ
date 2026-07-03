/**
 * Shared hiring session service — one engine for every entry surface.
 *
 * Surfaces: onboarding, top_nav_hire_button, hire_route, maya_direct_chat, maya_hiring_topic
 */

import { synthesizeBriefForHiringContext } from "./build-brief";
import {
  bootstrapStateFromTopicRole,
  roleSnapshotFromState,
  type HiringSessionScope,
  type HiringSessionSource,
} from "./canonical-session";
import {
  guardHireCandidate,
  validateSessionCandidates,
  type CandidateSessionContext,
} from "./candidate-validation";
import { callCandidates } from "./hiring-api";
import {
  clearHiringSessionCandidates,
  loadDurableHiringSession,
  type HiringBackendMode,
} from "./hiring-persistence";
import {
  completeHireFromCandidate,
  logCandidatesGenerated,
  type HireActions,
} from "./hire-completion";
import { persistHiringSessionMemories } from "./hiring-memory";
import { stampCandidatesForSession } from "./maya-hiring-proposal";
import {
  mayaHiringProposalMessage,
  type MayaHiringProposal,
} from "./maya-hiring-proposal";
import { createMayaHiringTopic } from "./maya-dm-topics";
import { inferRoleFromText } from "./role-inference";
import { clearHiringSession, initialHiringSession } from "./session";
import type {
  AiEmployeeApplicant,
  AiEmployeeJobBrief,
  HiringSessionState,
} from "./types";
import type { RoomTopic } from "@/lib/types";

export type HiringSurface =
  | "onboarding"
  | "top_nav_hire_button"
  | "hire_route"
  | "maya_direct_chat"
  | "maya_hiring_topic";

export type HiringSurfaceConfig = {
  scope: HiringSessionScope;
  source: HiringSessionSource;
  dmFirst: boolean;
  sessionScopeKey: string;
};

export function resolveHiringSurface(params: {
  surface: HiringSurface;
  mayaRoomId: string;
  mayaTopicId?: string;
}): HiringSurfaceConfig {
  const { surface, mayaRoomId, mayaTopicId } = params;

  if (surface === "maya_hiring_topic" && mayaTopicId) {
    return {
      scope: {
        mayaRoomId,
        mayaTopicId,
        source: "maya_hiring_topic",
      },
      source: "maya_hiring_topic",
      dmFirst: true,
      sessionScopeKey: mayaTopicId,
    };
  }

  if (surface === "maya_direct_chat") {
    return {
      scope: {
        mayaRoomId,
        directChat: true,
        source: "maya_direct_chat",
      },
      source: "maya_direct_chat",
      dmFirst: true,
      sessionScopeKey: `direct-${mayaRoomId}`,
    };
  }

  const source: HiringSessionSource =
    surface === "onboarding"
      ? "onboarding"
      : surface === "top_nav_hire_button"
        ? "top_nav_hire_button"
        : "hire_route";

  return {
    scope: {
      mayaRoomId,
      hireRoute: true,
      source,
    },
    source,
    dmFirst: false,
    sessionScopeKey: "hire-route",
  };
}

export function candidateContextFromSession(
  session: HiringSessionState,
  sessionId?: string | null,
): CandidateSessionContext {
  const snap = roleSnapshotFromState(session);
  return {
    sessionId,
    roleKey: session.roleKey,
    roleTitle: snap.roleTitle,
    roleSetAt: session.roleSetAt,
  };
}

export function validateCandidatesForSession(
  candidates: AiEmployeeApplicant[],
  ctx: CandidateSessionContext,
) {
  return validateSessionCandidates(candidates, ctx);
}

export function visibleCandidatesForSession(
  candidates: AiEmployeeApplicant[],
  ctx: CandidateSessionContext,
): AiEmployeeApplicant[] {
  return validateSessionCandidates(candidates, ctx).valid;
}

export async function loadHiringSessionForSurface(params: {
  backend: HiringBackendMode;
  workspaceId?: string;
  userId?: string;
  surface: HiringSurface;
  mayaRoomId: string;
  mayaTopicId?: string;
  topicBootstrap?: { topicId: string; roleTitle: string; roleKey: string | null };
  sessionId?: string | null;
}) {
  const { scope, dmFirst, source } = resolveHiringSurface({
    surface: params.surface,
    mayaRoomId: params.mayaRoomId,
    mayaTopicId: params.mayaTopicId,
  });

  const result = await loadDurableHiringSession({
    backend: params.backend,
    workspaceId: params.workspaceId,
    userId: params.userId,
    mayaRoomId: params.mayaRoomId,
    scope,
    dmFirst,
    sessionId: params.sessionId,
    topicBootstrap: params.topicBootstrap,
  });

  return {
    ...result,
    scope,
    source,
    sessionScopeKey: resolveHiringSurface({
      surface: params.surface,
      mayaRoomId: params.mayaRoomId,
      mayaTopicId: params.mayaTopicId,
    }).sessionScopeKey,
  };
}

/** Alias — load existing session or return initial state for the surface. */
export const getOrCreateHiringSession = loadHiringSessionForSurface;

export function proposeHiringTopic(userText: string): MayaHiringProposal | null {
  const inference = inferRoleFromText(userText);
  const match = inference.matches[0];
  if (!match?.roleKey) return null;
  return {
    userText,
    roleTitle: match.title,
    roleKey: match.roleKey,
  };
}

export { mayaHiringProposalMessage };

export async function createHiringTopicForSession(params: {
  roomId: string;
  workspaceId: string;
  userId?: string;
  roleTitle: string;
  roleKey?: string | null;
  backend: HiringBackendMode;
  upsertTopic: (topic: RoomTopic) => void;
  existingTopics?: RoomTopic[];
  forceNewTitle?: boolean;
}): Promise<RoomTopic> {
  return createMayaHiringTopic(params);
}

export function attachSessionToTopic(
  state: HiringSessionState,
  topicId: string,
  source: HiringSessionSource = "maya_hiring_topic",
): HiringSessionState {
  return {
    ...state,
    hiringTopicId: topicId,
    sessionSource: source,
  };
}

export function updateJobBrief(
  state: HiringSessionState,
  brief: AiEmployeeJobBrief,
  partial?: Partial<AiEmployeeJobBrief>,
): Pick<HiringSessionState, "brief" | "briefPartial" | "briefReady"> {
  const merged = partial ? { ...brief, ...partial } : brief;
  return {
    brief: merged,
    briefPartial: merged,
    briefReady: state.readiness?.ready ?? state.briefReady,
  };
}

export function resolveBriefForSession(
  session: HiringSessionState,
  roleSeed: string,
  departmentId: string | null,
): AiEmployeeJobBrief {
  return (
    session.brief ??
    synthesizeBriefForHiringContext({
      roleSeed,
      messages: session.recruiterMessages,
      departmentId,
      roleKey: session.roleKey,
      existing: session.briefPartial,
    })
  );
}

export async function generateCandidatesForSession(params: {
  brief: AiEmployeeJobBrief;
  departmentId: string | null;
  roleKey: string | null;
  sessionScopeKey: string;
  sessionId?: string | null;
  roleTitle?: string;
}): Promise<AiEmployeeApplicant[]> {
  const roleTitle = params.roleTitle ?? params.brief.roleTitle;
  let candidates: AiEmployeeApplicant[];

  try {
    const res = await callCandidates(params.brief, params.departmentId, params.roleKey);
    candidates = res.candidates;
  } catch {
    const { generateDeterministicCandidates } = await import("./candidate-engine");
    candidates = generateDeterministicCandidates(
      params.brief,
      params.departmentId,
      params.roleKey,
      undefined,
      params.sessionScopeKey,
    );
  }

  return stampCandidatesForSession(
    candidates,
    params.sessionScopeKey,
    params.roleKey,
    roleTitle,
    params.sessionId,
  );
}

export type CompleteHireFromSessionParams = {
  actions: HireActions & {
    createMemory?: (
      entry: Partial<import("@/lib/types").MemoryEntry> & {
        title: string;
        content: string;
        roomId: string;
      },
    ) => import("@/lib/types").MemoryEntry;
    completeFirstHire?: (payload: {
      employee: ReturnType<typeof import("./map-candidate").candidateToEmployee>;
      workLog: import("@/lib/types").WorkLogEvent;
      defaultRoomId?: string;
    }) => Promise<{ dmRoomId: string }>;
  };
  candidate: AiEmployeeApplicant;
  session: HiringSessionState;
  sessionCandidates: AiEmployeeApplicant[];
  ctx: CandidateSessionContext;
  brief: AiEmployeeJobBrief;
  departmentId: string | null;
  roleKey: string | null;
  workspaceId: string | null;
  userId?: string | null;
  sessionId?: string | null;
  existingMemory?: import("@/lib/types").MemoryEntry[];
  userName?: string;
  mayaRoomId?: string;
  mayaTopicId?: string;
  allTopics?: RoomTopic[];
  onboarding?: {
    defaultRoomId?: string;
    onComplete?: () => void;
  };
  tryClaimHireLock: () => Promise<boolean>;
  releaseHireLock: () => void;
  completeDurableHire: (params: {
    state: HiringSessionState;
    hiredEmployeeId: string;
    dmRoomId: string;
    candidateId: string;
  }) => Promise<void>;
};

export type CompleteHireResult =
  | { ok: true; employeeId: string; dmRoomId: string }
  | { ok: false; message: string };

export async function completeHireFromSession(
  params: CompleteHireFromSessionParams,
): Promise<CompleteHireResult> {
  const guard = guardHireCandidate({
    candidate: params.candidate,
    sessionCandidates: params.sessionCandidates,
    ctx: params.ctx,
    hiredEmployeeId: params.session.hiredEmployeeId,
    workspaceId: params.workspaceId,
  });

  if (!guard.ok) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[hiring] completeHireFromSession blocked:", guard.reason);
    }
    return { ok: false, message: guard.message };
  }

  const locked = await params.tryClaimHireLock();
  if (!locked) {
    return { ok: false, message: "Hire already in progress. Please wait." };
  }

  try {
    const { employeeId, dmRoomId } = completeHireFromCandidate({
      actions: params.actions,
      userName: params.userName,
      candidate: params.candidate,
      brief: params.brief,
      departmentId: params.departmentId,
      roleKey: params.roleKey,
      mayaRoomId: params.mayaRoomId,
      mayaTopicId: params.mayaTopicId,
      allTopics: params.allTopics,
      defaultRoomId: params.onboarding?.defaultRoomId,
      skipWorkLog: Boolean(params.onboarding),
    });

    if (params.onboarding && params.actions.completeFirstHire) {
      const { candidateToEmployee } = await import("./map-candidate");
      const employee = candidateToEmployee(
        params.candidate,
        params.brief,
        params.departmentId,
        params.roleKey,
      );
      employee.id = employeeId;
      if (params.onboarding.defaultRoomId) {
        employee.defaultRoomId = params.onboarding.defaultRoomId;
      }

      const { uid, nowISO } = await import("@/lib/utils");
      const workLog = {
        id: uid("wl"),
        roomId: params.onboarding.defaultRoomId ?? params.mayaRoomId ?? dmRoomId,
        employeeId,
        action: "Employee hired",
        summary: `Hired ${employee.name} as ${params.candidate.title}.`,
        status: "success" as const,
        createdAt: nowISO(),
      };

      await params.actions.completeFirstHire({
        employee,
        workLog,
        defaultRoomId: params.onboarding.defaultRoomId,
      });
      params.onboarding.onComplete?.();
    }

    await params.completeDurableHire({
      state: { ...params.session, brief: params.brief },
      hiredEmployeeId: employeeId,
      dmRoomId,
      candidateId: params.candidate.id,
    });

    if (params.actions.createMemory) {
      persistHiringSessionMemories({
        workspaceId: params.workspaceId,
        userId: params.userId,
        sessionId: params.sessionId,
        candidate: params.candidate,
        brief: params.brief,
        employeeId,
        employeeName: params.candidate.name,
        dmRoomId,
        existingMemory: params.existingMemory,
        createMemory: params.actions.createMemory,
      });
    }

    return { ok: true, employeeId, dmRoomId };
  } catch (error) {
    params.releaseHireLock();
    throw error;
  }
}

export async function cancelHiringSession(params: {
  scope: HiringSessionScope;
  sessionId?: string | null;
  backend?: HiringBackendMode;
}): Promise<void> {
  clearHiringSession(params.scope);
  if (params.sessionId && params.backend === "supabase") {
    await clearHiringSessionCandidates(params.sessionId).catch(() => undefined);
  }
}

export function initialSessionForSurface(
  surface: HiringSurface,
  topicBootstrap?: { topicId: string; roleTitle: string; roleKey: string | null },
): HiringSessionState {
  const { source, dmFirst } = resolveHiringSurface({
    surface,
    mayaRoomId: "",
    mayaTopicId: topicBootstrap?.topicId,
  });

  if (topicBootstrap && surface === "maya_hiring_topic") {
    return bootstrapStateFromTopicRole({
      roleTitle: topicBootstrap.roleTitle,
      roleKey: topicBootstrap.roleKey,
      topicId: topicBootstrap.topicId,
    });
  }

  return {
    ...initialHiringSession(),
    ...(dmFirst ? { step: "recruiter" as const } : {}),
    sessionSource: source,
  };
}

export function logCandidatesGeneratedForSession(
  actions: HireActions,
  mayaRoomId: string,
  roleTitle: string,
) {
  logCandidatesGenerated(actions, mayaRoomId, roleTitle);
}
