"use client";

import { supabase } from "@/lib/supabase/client";
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

export type HiringSessionStatus = "active" | "hiring" | "hired" | "abandoned";

type PersistedHiringPayload = Omit<
  HiringSessionState,
  "brief" | "briefPartial" | "candidates" | "busy" | "error" | "regenSpin" | "compareOpen" | "interviewWith"
>;

const ACTIVE_STATUSES: HiringSessionStatus[] = ["active", "hiring"];

function jsonObject<T extends object>(value: unknown, fallback: T): T {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as T)
    : fallback;
}

function hasMeaningfulHiringProgress(state: HiringSessionState): boolean {
  return (
    state.recruiterMessages.length > 0 ||
    state.candidates.length > 0 ||
    Boolean(state.brief) ||
    Boolean(state.briefPartial && Object.keys(state.briefPartial).length > 0) ||
    Boolean(state.roleInput.trim())
  );
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
): HiringSessionState {
  const base = initialHiringSession();
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
    brief: brief ?? undefined,
    briefPartial: briefPartial ?? undefined,
    candidates,
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
    },
    row.job_brief as AiEmployeeJobBrief | null,
    row.job_brief_partial as Partial<AiEmployeeJobBrief> | null,
    candidates,
  );

  if (!state.roleKey && state.departmentId) {
    const migrated = migrateLegacyDepartmentId(state.departmentId, state.roleInput);
    if (migrated) state.roleKey = migrated;
  }

  return state;
}

async function loadCandidatesForSession(
  sessionId: string,
): Promise<AiEmployeeApplicant[]> {
  const { data, error } = await supabase
    .from("hiring_candidates")
    .select("candidate, sort_order")
    .eq("hiring_session_id", sessionId)
    .order("sort_order", { ascending: true });

  if (error) throw error;
  return (data ?? []).map((row) => row.candidate as AiEmployeeApplicant);
}

export async function fetchActiveHiringSession(params: {
  workspaceId: string;
  userId: string;
  mayaRoomId: string;
}): Promise<{ sessionId: string; state: HiringSessionState; updatedAt: string } | null> {
  const { data, error } = await supabase
    .from("hiring_sessions")
    .select("*")
    .eq("workspace_id", params.workspaceId)
    .eq("user_id", params.userId)
    .eq("maya_room_id", params.mayaRoomId)
    .in("status", ACTIVE_STATUSES)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const candidates = await loadCandidatesForSession(String(data.id));
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
  mayaTopicId?: string;
  state: HiringSessionState;
}): Promise<string> {
  const payload = toPersistedPayload(params.state);
  const row = {
    workspace_id: params.workspaceId,
    user_id: params.userId,
    maya_room_id: params.mayaRoomId,
    maya_topic_id: params.mayaTopicId ?? null,
    status: "active" as const,
    step: params.state.step,
    session_state: payload,
    job_brief: params.state.brief ?? null,
    job_brief_partial: params.state.briefPartial ?? null,
    hired_employee_id: params.state.hiredEmployeeId ?? null,
    dm_room_id: params.state.dmRoomId ?? null,
  };

  if (params.sessionId) {
    const { data, error } = await supabase
      .from("hiring_sessions")
      .update(row)
      .eq("id", params.sessionId)
      .in("status", ACTIVE_STATUSES)
      .select("id")
      .maybeSingle();

    if (error) throw error;
    if (data?.id) {
      await syncHiringCandidates(params.sessionId, params.workspaceId, params.state.candidates);
      return String(data.id);
    }
  }

  const existing = await fetchActiveHiringSession({
    workspaceId: params.workspaceId,
    userId: params.userId,
    mayaRoomId: params.mayaRoomId,
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
  await syncHiringCandidates(sessionId, params.workspaceId, params.state.candidates);
  return sessionId;
}

export async function syncHiringCandidates(
  sessionId: string,
  workspaceId: string,
  candidates: AiEmployeeApplicant[],
): Promise<void> {
  if (candidates.length === 0) return;

  const rows = candidates.map((candidate, index) => ({
    hiring_session_id: sessionId,
    workspace_id: workspaceId,
    candidate_id: candidate.id,
    sort_order: index,
    candidate,
    hired: false,
  }));

  const { error: deleteError } = await supabase
    .from("hiring_candidates")
    .delete()
    .eq("hiring_session_id", sessionId);

  if (deleteError) throw deleteError;

  const { error: insertError } = await supabase.from("hiring_candidates").insert(rows);
  if (insertError) throw insertError;
}

export async function claimHireLock(sessionId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("hiring_sessions")
    .update({ status: "hiring" })
    .eq("id", sessionId)
    .eq("status", "active")
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

export async function loadDurableHiringSession(params: {
  backend: HiringBackendMode;
  workspaceId?: string;
  userId?: string;
  mayaRoomId: string;
  dmFirst?: boolean;
}): Promise<{ sessionId: string | null; state: HiringSessionState }> {
  const cached = loadHiringSession({ dmFirst: params.dmFirst });
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
    });

    if (remote) {
      const state = normalizeRestoredHiringSession(remote.state, { dmFirst: params.dmFirst });
      persistHiringSession(state);
      return { sessionId: remote.sessionId, state };
    }

    if (cachedState && hasMeaningfulHiringProgress(cachedState)) {
      const sessionId = await saveHiringSession({
        sessionId: null,
        workspaceId: params.workspaceId!,
        userId: params.userId!,
        mayaRoomId: params.mayaRoomId,
        state: cachedState,
      });
      persistHiringSession(cachedState);
      return { sessionId, state: cachedState };
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
  mayaTopicId?: string;
  state: HiringSessionState;
}): Promise<string | null> {
  persistHiringSession(params.state);

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
      mayaTopicId: params.mayaTopicId,
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
}): Promise<void> {
  clearHiringSession();

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
