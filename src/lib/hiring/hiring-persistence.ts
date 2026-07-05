"use client";

import { supabase } from "@/lib/supabase/client";
import {
  ACTIVE_HIRING_STATUSES,
  bootstrapStateFromTopicRole,
  deriveSessionStatus,
  roleSnapshotFromState,
  type HiringSessionScope,
  type HiringSessionSource,
  type HiringSessionStatus,
} from "./canonical-session";
import { EMPTY_READINESS } from "./recruiter-brain";
import { emptyChecklist } from "./recruiter-checklist";
import { migrateLegacyDepartmentId } from "./role-library";
import {
  clearHiringSession,
  initialHiringSession,
  loadHiringSession,
  normalizeRestoredHiringSession,
  persistHiringSession,
} from "./session";
import type {
  AiEmployeeApplicant,
  AiEmployeeJobBrief,
  HiringSessionState,
  HiringStep,
} from "./types";

type DbRow = Record<string, unknown>;

export type HiringBackendMode = "supabase" | "demo";

/** @deprecated use HiringSessionStatus from canonical-session */
export type HiringSessionStatusLegacy = "active" | "hiring" | "hired" | "abandoned";

type PersistedHiringPayload = Omit<
  HiringSessionState,
  "brief" | "briefPartial" | "candidates" | "busy" | "error" | "regenSpin" | "compareOpen" | "interviewWith"
>;

function jsonObject<T extends object>(value: unknown, fallback: T): T {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as T)
    : fallback;
}

export function hasMeaningfulHiringProgress(state: HiringSessionState): boolean {
  return (
    state.recruiterMessages.length > 0 ||
    state.candidates.length > 0 ||
    Boolean(state.brief) ||
    Boolean(state.briefPartial && Object.keys(state.briefPartial).length > 0) ||
    Boolean(state.roleInput.trim()) ||
    state.step !== "role"
  );
}

function resolveSource(scope: HiringSessionScope, state: HiringSessionState): HiringSessionSource {
  if (state.sessionSource) return state.sessionSource;
  if (scope.hireRoute) return "hire_route";
  if (scope.directChat) return "maya_direct_chat";
  if (scope.mayaTopicId) return "maya_hiring_topic";
  return "maya_direct_chat";
}

function toPersistedPayload(state: HiringSessionState): PersistedHiringPayload {
  const {
    brief: _brief,
    briefPartial: _briefPartial,
    candidates: _candidates,
    busy: _busy,
    error: _error,
    regenSpin: _regenSpin,
    compareOpen: _compareOpen,
    interviewWith: _interviewWith,
    ...payload
  } = state;
  void _brief;
  void _briefPartial;
  void _candidates;
  void _busy;
  void _error;
  void _regenSpin;
  void _compareOpen;
  void _interviewWith;
  return payload;
}

function mergePersistedState(
  payload: Partial<PersistedHiringPayload>,
  brief: AiEmployeeJobBrief | null | undefined,
  briefPartial: Partial<AiEmployeeJobBrief> | null | undefined,
  candidates: AiEmployeeApplicant[],
  row?: DbRow,
): HiringSessionState {
  const base = initialHiringSession();
  const roleSnap = row
    ? {
        roleKey: (row.role_key as string | null) ?? payload.roleKey,
        roleTitle: (row.role_title as string | null) ?? undefined,
      }
    : null;

  const filteredCandidates =
    roleSnap?.roleKey &&
    candidates.length > 0 &&
    candidates.some((c) => c.roleKey && c.roleKey !== roleSnap.roleKey)
      ? []
      : candidates;

  return {
    ...base,
    ...payload,
    checklist: payload.checklist ?? base.checklist,
    readiness: payload.readiness ?? base.readiness,
    suggestionChips: payload.suggestionChips ?? [],
    recruiterMessages: payload.recruiterMessages ?? [],
    suggestedRoleKeys: payload.suggestedRoleKeys ?? [],
    advOpen: payload.advOpen ?? {},
    interviewMsgs: payload.interviewMsgs ?? {},
    roleKey: roleSnap?.roleKey ?? payload.roleKey ?? base.roleKey,
    roleInput: payload.roleInput ?? (roleSnap?.roleTitle ? roleSnap.roleTitle : base.roleInput),
    brief: brief ?? undefined,
    briefPartial: briefPartial ?? undefined,
    candidates: filteredCandidates,
    sessionSource: (row?.source as HiringSessionSource | undefined) ?? payload.sessionSource,
    sessionStatus: (row?.status as HiringSessionStatus | undefined) ?? payload.sessionStatus,
    hiringTopicId: (row?.maya_topic_id as string | null) ?? payload.hiringTopicId,
    busy: false,
    error: null,
    regenSpin: false,
    compareOpen: false,
    interviewWith: null,
  };
}

function rowToState(row: DbRow, candidates: AiEmployeeApplicant[]): HiringSessionState {
  const payload = jsonObject<Partial<PersistedHiringPayload>>(row.session_state, {});
  const state = mergePersistedState(
    {
      ...payload,
      step: (row.step as HiringStep) ?? payload.step ?? "role",
      hiredEmployeeId: (row.hired_employee_id as string | null) ?? payload.hiredEmployeeId,
      dmRoomId: (row.dm_room_id as string | null) ?? payload.dmRoomId,
      selectedCandidateId:
        (row.selected_candidate_id as string | null) ?? payload.selectedCandidateId,
    },
    row.job_brief as AiEmployeeJobBrief | null,
    row.job_brief_partial as Partial<AiEmployeeJobBrief> | null,
    candidates,
    row,
  );

  if (!state.roleKey && state.departmentId) {
    const migrated = migrateLegacyDepartmentId(state.departmentId, state.roleInput);
    if (migrated) state.roleKey = migrated;
  }

  return state;
}

async function loadCandidatesForSession(
  sessionId: string,
  expectedRoleKey?: string | null,
): Promise<AiEmployeeApplicant[]> {
  const { data, error } = await supabase
    .from("hiring_candidates")
    .select("candidate, sort_order, role_key")
    .eq("hiring_session_id", sessionId)
    .order("sort_order", { ascending: true });

  if (error) throw error;
  const rows = data ?? [];
  if (
    expectedRoleKey &&
    rows.length > 0 &&
    rows.some((r) => r.role_key && r.role_key !== expectedRoleKey)
  ) {
    return [];
  }
  return rows.map((row) => row.candidate as AiEmployeeApplicant);
}

export async function fetchActiveHiringSession(params: {
  workspaceId: string;
  userId: string;
  mayaRoomId: string;
  scope: HiringSessionScope;
  sessionId?: string | null;
}): Promise<{ sessionId: string; state: HiringSessionState; updatedAt: string } | null> {
  if (params.sessionId) {
    const { data, error } = await supabase
      .from("hiring_sessions")
      .select("*")
      .eq("id", params.sessionId)
      .eq("workspace_id", params.workspaceId)
      .eq("user_id", params.userId)
      .in("status", ACTIVE_HIRING_STATUSES)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const candidates = await loadCandidatesForSession(
      String(data.id),
      data.role_key as string | null,
    );
    return {
      sessionId: String(data.id),
      state: rowToState(data as DbRow, candidates),
      updatedAt: String(data.updated_at),
    };
  }

  let query = supabase
    .from("hiring_sessions")
    .select("*")
    .eq("workspace_id", params.workspaceId)
    .eq("user_id", params.userId)
    .in("status", ACTIVE_HIRING_STATUSES);

  if (params.scope.mayaTopicId && !params.scope.directChat && !params.scope.hireRoute) {
    query = query.eq("maya_topic_id", params.scope.mayaTopicId);
  } else if (params.scope.directChat) {
    query = query
      .eq("maya_room_id", params.mayaRoomId)
      .is("maya_topic_id", null)
      .eq("source", "maya_direct_chat");
  } else if (params.scope.hireRoute) {
    query = query
      .is("maya_topic_id", null)
      .in("source", ["hire_route", "onboarding", "top_nav_hire_button"]);
  } else {
    return null;
  }

  const { data, error } = await query
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const candidates = await loadCandidatesForSession(
    String(data.id),
    data.role_key as string | null,
  );
  return {
    sessionId: String(data.id),
    state: rowToState(data as DbRow, candidates),
    updatedAt: String(data.updated_at),
  };
}

export async function saveHiringSession(params: {
  sessionId: string | null;
  workspaceId: string;
  userId: string;
  mayaRoomId: string;
  scope: HiringSessionScope;
  state: HiringSessionState;
}): Promise<string> {
  const payload = toPersistedPayload(params.state);
  const roleSnap = roleSnapshotFromState(params.state);
  const source = resolveSource(params.scope, params.state);
  const status = deriveSessionStatus(params.state);
  const topicId =
    params.scope.directChat || params.scope.hireRoute
      ? null
      : params.scope.mayaTopicId ?? null;

  const row = {
    workspace_id: params.workspaceId,
    user_id: params.userId,
    maya_room_id: params.mayaRoomId,
    maya_topic_id: topicId,
    source,
    status,
    step: params.state.step,
    session_state: { ...payload, sessionSource: source, sessionStatus: status },
    job_brief: params.state.brief ?? null,
    job_brief_partial: params.state.briefPartial ?? null,
    role_title: roleSnap.roleTitle,
    role_key: roleSnap.roleKey,
    department: roleSnap.department,
    readiness_score: params.state.readiness?.score ?? null,
    required_questions_answered: params.state.readiness?.missing?.length
      ? Math.max(0, 8 - params.state.readiness.missing.length)
      : 0,
    selected_candidate_id: params.state.selectedCandidateId ?? null,
    hired_employee_id: params.state.hiredEmployeeId ?? null,
    dm_room_id: params.state.dmRoomId ?? null,
  };

  if (params.sessionId) {
    const { data, error } = await supabase
      .from("hiring_sessions")
      .update(row)
      .eq("id", params.sessionId)
      .in("status", ACTIVE_HIRING_STATUSES)
      .select("id")
      .maybeSingle();

    if (error) throw error;
    if (data?.id) {
      await syncHiringCandidates(
        params.sessionId,
        params.workspaceId,
        params.state.candidates,
        roleSnap.roleKey,
        roleSnap.roleTitle,
      );
      return String(data.id);
    }
  }

  const existing = await fetchActiveHiringSession({
    workspaceId: params.workspaceId,
    userId: params.userId,
    mayaRoomId: params.mayaRoomId,
    scope: params.scope,
  });

  if (existing) {
    return saveHiringSession({ ...params, sessionId: existing.sessionId });
  }

  const { data, error } = await supabase
    .from("hiring_sessions")
    .insert(row)
    .select("id")
    .single();

  if (error) throw error;
  const sessionId = String(data.id);
  await syncHiringCandidates(
    sessionId,
    params.workspaceId,
    params.state.candidates,
    roleSnap.roleKey,
    roleSnap.roleTitle,
  );
  return sessionId;
}

export async function syncHiringCandidates(
  sessionId: string,
  workspaceId: string,
  candidates: AiEmployeeApplicant[],
  roleKey?: string | null,
  roleTitle?: string | null,
): Promise<void> {
  const { error: deleteError } = await supabase
    .from("hiring_candidates")
    .delete()
    .eq("hiring_session_id", sessionId);

  if (deleteError) throw deleteError;
  if (candidates.length === 0) return;

  const rows = candidates.map((candidate, index) => ({
    hiring_session_id: sessionId,
    workspace_id: workspaceId,
    candidate_id: candidate.id,
    sort_order: index,
    candidate: {
      ...candidate,
      roleKey: candidate.roleKey ?? roleKey ?? undefined,
      roleTitle: candidate.roleTitle ?? roleTitle ?? undefined,
      hiringSessionId: sessionId,
    },
    role_key: candidate.roleKey ?? roleKey ?? null,
    role_title: candidate.roleTitle ?? roleTitle ?? null,
    hired: false,
  }));

  const { error: insertError } = await supabase.from("hiring_candidates").insert(rows);
  if (insertError) throw insertError;
}

export async function claimHireLock(sessionId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("hiring_sessions")
    .update({ status: "active" })
    .eq("id", sessionId)
    .in("status", ACTIVE_HIRING_STATUSES)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  return Boolean(data?.id);
}

export async function markHiringSessionHired(params: {
  sessionId: string;
  workspaceId: string;
  state: HiringSessionState;
  hiredEmployeeId: string;
  dmRoomId: string;
  candidateId: string;
}): Promise<void> {
  const payload = toPersistedPayload({
    ...params.state,
    hiredEmployeeId: params.hiredEmployeeId,
    dmRoomId: params.dmRoomId,
    step: "success",
    sessionStatus: "hired",
  });

  const { error: sessionError } = await supabase
    .from("hiring_sessions")
    .update({
      status: "hired",
      step: "success",
      session_state: payload,
      job_brief: params.state.brief ?? null,
      job_brief_partial: params.state.briefPartial ?? null,
      hired_employee_id: params.hiredEmployeeId,
      dm_room_id: params.dmRoomId,
      selected_candidate_id: params.candidateId,
    })
    .eq("id", params.sessionId);

  if (sessionError) throw sessionError;

  const { error: candidateError } = await supabase
    .from("hiring_candidates")
    .update({
      hired: true,
      hired_employee_id: params.hiredEmployeeId,
    })
    .eq("hiring_session_id", params.sessionId)
    .eq("candidate_id", params.candidateId);

  if (candidateError) throw candidateError;
}

export async function clearHiringSessionCandidates(sessionId: string): Promise<void> {
  const { error } = await supabase
    .from("hiring_candidates")
    .delete()
    .eq("hiring_session_id", sessionId);
  if (error) throw error;
}

export async function markHiringSessionCancelled(params: {
  sessionId: string;
  workspaceId: string;
}): Promise<void> {
  const { error } = await supabase
    .from("hiring_sessions")
    .update({ status: "cancelled" })
    .eq("id", params.sessionId)
    .eq("workspace_id", params.workspaceId)
    .in("status", ACTIVE_HIRING_STATUSES);

  if (error) throw error;
}

/** Clear local cache and mark the durable session abandoned. */
export async function abandonDurableHiringSession(params: {
  backend: HiringBackendMode;
  sessionId: string | null;
  workspaceId?: string;
  scope: HiringSessionScope;
}): Promise<void> {
  clearHiringSession(params.scope);

  if (params.backend !== "supabase" || !params.sessionId || !params.workspaceId) {
    return;
  }

  try {
    await markHiringSessionCancelled({
      sessionId: params.sessionId,
      workspaceId: params.workspaceId,
    });
    await clearHiringSessionCandidates(params.sessionId);
  } catch (error) {
    console.warn("[AdeHQ hiring] Failed to abandon durable session.", error);
  }
}

/** Cancel any in-progress hire-route session and return a clean role-selection state. */
export async function beginFreshHiringSession(params: {
  backend: HiringBackendMode;
  workspaceId?: string;
  userId?: string;
  mayaRoomId: string;
  scope: HiringSessionScope;
  dmFirst?: boolean;
  source?: HiringSessionSource;
}): Promise<{ sessionId: null; state: HiringSessionState }> {
  clearHiringSession(params.scope);

  const freshState: HiringSessionState = {
    ...initialHiringSession(),
    ...(params.dmFirst ? { step: "recruiter" as const } : {}),
    ...(params.source ? { sessionSource: params.source } : {}),
  };

  const canUseSupabase =
    params.backend === "supabase" &&
    Boolean(params.workspaceId) &&
    Boolean(params.userId) &&
    Boolean(params.mayaRoomId);

  if (canUseSupabase) {
    try {
      const remote = await fetchActiveHiringSession({
        workspaceId: params.workspaceId!,
        userId: params.userId!,
        mayaRoomId: params.mayaRoomId,
        scope: params.scope,
      });
      if (remote) {
        await markHiringSessionCancelled({
          sessionId: remote.sessionId,
          workspaceId: params.workspaceId!,
        });
        await clearHiringSessionCandidates(remote.sessionId);
      }
    } catch (error) {
      console.warn("[AdeHQ hiring] Failed to clear prior hire-route session.", error);
    }
  }

  return { sessionId: null, state: freshState };
}

export async function loadDurableHiringSession(params: {
  backend: HiringBackendMode;
  workspaceId?: string;
  userId?: string;
  mayaRoomId: string;
  scope: HiringSessionScope;
  dmFirst?: boolean;
  sessionId?: string | null;
  topicBootstrap?: { topicId: string; roleTitle: string; roleKey: string | null };
}): Promise<{ sessionId: string | null; state: HiringSessionState }> {
  const cached = loadHiringSession({ dmFirst: params.dmFirst, scope: params.scope });
  const cachedState = cached
    ? normalizeRestoredHiringSession(cached, { dmFirst: params.dmFirst })
    : null;

  const canUseSupabase =
    params.backend === "supabase" &&
    Boolean(params.workspaceId) &&
    Boolean(params.userId) &&
    Boolean(params.mayaRoomId);

  if (!canUseSupabase) {
    return {
      sessionId: null,
      state: cachedState ?? {
        ...initialHiringSession(),
        ...(params.dmFirst ? { step: "recruiter" as const } : {}),
      },
    };
  }

  try {
    const remote = await fetchActiveHiringSession({
      workspaceId: params.workspaceId!,
      userId: params.userId!,
      mayaRoomId: params.mayaRoomId,
      scope: params.scope,
      sessionId: params.sessionId,
    });

    if (remote) {
      if (
        params.topicBootstrap?.roleKey &&
        remote.state.roleKey &&
        remote.state.roleKey !== params.topicBootstrap.roleKey
      ) {
        const bootstrapped = bootstrapStateFromTopicRole({
          roleTitle: params.topicBootstrap.roleTitle,
          roleKey: params.topicBootstrap.roleKey,
          topicId: params.topicBootstrap.topicId,
        });
        clearHiringSession(params.scope);
        persistHiringSession(bootstrapped, params.scope);
        return { sessionId: null, state: bootstrapped };
      }
      const state = normalizeRestoredHiringSession(remote.state, { dmFirst: params.dmFirst });
      persistHiringSession(state, params.scope);
      return { sessionId: remote.sessionId, state };
    }

    if (cachedState && hasMeaningfulHiringProgress(cachedState)) {
      // Reject cached state if role no longer matches topic metadata
      if (
        params.topicBootstrap &&
        cachedState.roleKey &&
        params.topicBootstrap.roleKey &&
        cachedState.roleKey !== params.topicBootstrap.roleKey
      ) {
        clearHiringSession(params.scope);
      } else {
        const sessionId = await saveHiringSession({
          sessionId: null,
          workspaceId: params.workspaceId!,
          userId: params.userId!,
          mayaRoomId: params.mayaRoomId,
          scope: params.scope,
          state: cachedState,
        });
        persistHiringSession(cachedState, params.scope);
        return { sessionId, state: cachedState };
      }
    }

    if (params.topicBootstrap && params.scope.mayaTopicId && !params.scope.directChat) {
      const bootstrapped = bootstrapStateFromTopicRole({
        roleTitle: params.topicBootstrap.roleTitle,
        roleKey: params.topicBootstrap.roleKey,
        topicId: params.topicBootstrap.topicId,
      });
      persistHiringSession(bootstrapped, params.scope);
      return { sessionId: null, state: bootstrapped };
    }
  } catch (error) {
    console.warn("[AdeHQ hiring] Supabase session load failed; using cache.", error);
    if (cachedState) {
      return { sessionId: null, state: cachedState };
    }
  }

  return {
    sessionId: null,
    state: {
      ...initialHiringSession(),
      ...(params.dmFirst ? { step: "recruiter" as const } : {}),
    },
  };
}

export async function persistDurableHiringSession(params: {
  backend: HiringBackendMode;
  sessionId: string | null;
  workspaceId?: string;
  userId?: string;
  mayaRoomId: string;
  scope: HiringSessionScope;
  state: HiringSessionState;
}): Promise<string | null> {
  persistHiringSession(params.state, params.scope);

  if (
    params.backend !== "supabase" ||
    !params.workspaceId ||
    !params.userId ||
    !hasMeaningfulHiringProgress(params.state)
  ) {
    return params.sessionId;
  }

  try {
    return await saveHiringSession({
      sessionId: params.sessionId,
      workspaceId: params.workspaceId,
      userId: params.userId,
      mayaRoomId: params.mayaRoomId,
      scope: params.scope,
      state: params.state,
    });
  } catch (error) {
    console.warn("[AdeHQ hiring] Supabase session save failed; cache retained.", error);
    return params.sessionId;
  }
}

export async function finalizeDurableHiringSession(params: {
  backend: HiringBackendMode;
  sessionId: string | null;
  workspaceId?: string;
  state: HiringSessionState;
  hiredEmployeeId: string;
  dmRoomId: string;
  candidateId: string;
  scope?: HiringSessionScope;
}): Promise<void> {
  if (params.scope) {
    clearHiringSession(params.scope);
  } else {
    clearHiringSession();
  }

  if (params.backend !== "supabase" || !params.sessionId || !params.workspaceId) {
    return;
  }

  try {
    await markHiringSessionHired({
      sessionId: params.sessionId,
      workspaceId: params.workspaceId,
      state: params.state,
      hiredEmployeeId: params.hiredEmployeeId,
      dmRoomId: params.dmRoomId,
      candidateId: params.candidateId,
    });
  } catch (error) {
    console.warn("[AdeHQ hiring] Failed to mark session hired in Supabase.", error);
  }
}

export function emptyHiringReadinessFallback() {
  return { checklist: emptyChecklist(), readiness: EMPTY_READINESS };
}
