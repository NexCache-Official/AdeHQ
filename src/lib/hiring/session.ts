import type {
  AiEmployeeApplicant,
  AiEmployeeJobBrief,
  HiringSessionState,
  HiringStep,
  RecruiterChecklist,
  RecruiterMessage,
  RecruiterReadiness,
  RecruiterSuggestionChip,
} from "./types";
import type { HiringSessionScope } from "./canonical-session";
import { hiringSessionStorageKey, candidatesMatchRole } from "./canonical-session";
import { EMPTY_READINESS } from "./recruiter-brain";
import { emptyChecklist } from "./recruiter-checklist";
import { migrateLegacyDepartmentId, legacyDepartmentIdForRole } from "./role-library";

export const HIRING_SESSION_KEY = "adehq-hiring-session";

export function initialHiringSession(): HiringSessionState {
  return {
    step: "role",
    roleInput: "",
    departmentId: null,
    roleKey: null,
    departmentGroupId: null,
    discoveryMode: false,
    discoveryStep: null,
    inferenceConfidence: null,
    suggestedRoleKeys: [],
    customRoleTitle: null,
    recruiterMessages: [],
    checklist: emptyChecklist(),
    readiness: EMPTY_READINESS,
    suggestionChips: [],
    briefReady: false,
    candidates: [],
    genStep: 0,
    successStep: 0,
    advOpen: {},
    compareOpen: false,
    interviewWith: null,
    interviewMsgs: {},
    busy: false,
    error: null,
    briefEditable: false,
    regenSpin: false,
  };
}

export type HiringAction =
  | { type: "SET_STEP"; step: HiringStep }
  | { type: "SET_ROLE_INPUT"; roleInput: string }
  | { type: "SET_DEPARTMENT"; departmentId: string | null }
  | { type: "SET_ROLE_KEY"; roleKey: string | null; departmentGroupId?: string | null }
  | { type: "SET_DEPARTMENT_GROUP"; departmentGroupId: string | null }
  | { type: "SET_DISCOVERY"; discoveryMode: boolean; discoveryStep?: "outcome" | "narrow" | null }
  | { type: "SET_INFERENCE"; confidence: "high" | "medium" | "low" | null; suggestedRoleKeys: string[] }
  | { type: "SET_CUSTOM_ROLE_TITLE"; customRoleTitle: string | null }
  | { type: "ADD_MESSAGE"; message: RecruiterMessage }
  | { type: "SET_MESSAGES"; messages: RecruiterMessage[] }
  | { type: "SET_CHECKLIST"; checklist: RecruiterChecklist }
  | { type: "SET_READINESS"; readiness: RecruiterReadiness }
  | { type: "SET_SUGGESTION_CHIPS"; chips: RecruiterSuggestionChip[] }
  | { type: "SET_BRIEF"; brief: AiEmployeeJobBrief }
  | { type: "SET_BRIEF_PARTIAL"; briefPartial: Partial<AiEmployeeJobBrief> }
  | { type: "SET_BRIEF_READY"; briefReady: boolean }
  | { type: "SET_CANDIDATES"; candidates: AiEmployeeApplicant[] }
  | { type: "SELECT_CANDIDATE"; id: string }
  | { type: "TOGGLE_CANDIDATE_SELECT"; id: string }
  | { type: "SELECT_CANDIDATES"; ids: string[] }
  | {
      type: "COMPLETE_HIRE";
      employeeId: string;
      dmRoomId: string;
      dmTopicId?: string;
      employeeIds?: string[];
    }
  | { type: "SET_PENDING_ROOM"; roomId: string }
  | { type: "SET_GEN_STEP"; genStep: number }
  | { type: "SET_SUCCESS_STEP"; successStep: number }
  | { type: "TOGGLE_ADV"; id: string }
  | { type: "SET_COMPARE"; open: boolean }
  | { type: "SET_INTERVIEW"; id: string | null }
  | { type: "SET_INTERVIEW_MSGS"; id: string; messages: RecruiterMessage[] }
  | { type: "SET_BUSY"; busy: boolean }
  | { type: "SET_ERROR"; error: string | null }
  | { type: "SET_BRIEF_EDITABLE"; editable: boolean }
  | { type: "SET_REGEN_SPIN"; spin: boolean }
  | { type: "RESET_RECRUITER" }
  | {
      type: "RESET_FOR_ROLE";
      roleKey: string | null;
      roleTitle: string;
      roleInput: string;
      departmentId?: string | null;
    }
  | { type: "RESTORE"; state: HiringSessionState };

const BACK_MAP: Partial<Record<HiringStep, HiringStep>> = {
  recruiter: "role",
  brief: "recruiter",
  shortlist: "brief",
  offer: "shortlist",
};

export function hiringBackStep(step: HiringStep): HiringStep | null {
  return BACK_MAP[step] ?? null;
}

export function isPostHireHiringStep(step: HiringStep): boolean {
  return step === "success" || step === "assign_optional";
}

export function isPostHireHiringState(state: HiringSessionState): boolean {
  return Boolean(state.hiredEmployeeId) || isPostHireHiringStep(state.step);
}

export function hiringReducer(state: HiringSessionState, action: HiringAction): HiringSessionState {
  switch (action.type) {
    case "SET_STEP":
      return { ...state, step: action.step, error: null };
    case "SET_ROLE_INPUT":
      return { ...state, roleInput: action.roleInput };
    case "SET_DEPARTMENT":
      return { ...state, departmentId: action.departmentId };
    case "SET_ROLE_KEY": {
      const roleChanged =
        action.roleKey !== state.roleKey && state.roleKey != null && action.roleKey != null;
      const staleCandidates =
        roleChanged && !candidatesMatchRole(state.candidates, action.roleKey, state.customRoleTitle);
      return {
        ...state,
        roleKey: action.roleKey,
        departmentGroupId: action.departmentGroupId ?? state.departmentGroupId,
        departmentId: action.roleKey ? state.departmentId : state.departmentId,
        ...(roleChanged ? { roleSetAt: new Date().toISOString() } : {}),
        ...(staleCandidates
          ? {
              candidates: [],
              selectedCandidateId: undefined,
              briefReady: false,
              step: "recruiter" as const,
            }
          : {}),
      };
    }
    case "SET_DEPARTMENT_GROUP":
      return { ...state, departmentGroupId: action.departmentGroupId };
    case "SET_DISCOVERY":
      return {
        ...state,
        discoveryMode: action.discoveryMode,
        discoveryStep: action.discoveryStep ?? (action.discoveryMode ? "outcome" : null),
      };
    case "SET_INFERENCE":
      return {
        ...state,
        inferenceConfidence: action.confidence,
        suggestedRoleKeys: action.suggestedRoleKeys,
      };
    case "SET_CUSTOM_ROLE_TITLE":
      return { ...state, customRoleTitle: action.customRoleTitle };
    case "ADD_MESSAGE":
      return {
        ...state,
        recruiterMessages: [...state.recruiterMessages, action.message],
      };
    case "SET_MESSAGES":
      return { ...state, recruiterMessages: action.messages };
    case "SET_CHECKLIST":
      return { ...state, checklist: action.checklist };
    case "SET_READINESS":
      return { ...state, readiness: action.readiness };
    case "SET_SUGGESTION_CHIPS":
      return { ...state, suggestionChips: action.chips };
    case "SET_BRIEF":
      return { ...state, brief: action.brief, briefPartial: action.brief };
    case "SET_BRIEF_PARTIAL":
      return { ...state, briefPartial: action.briefPartial };
    case "SET_BRIEF_READY":
      return { ...state, briefReady: action.briefReady };
    case "SET_CANDIDATES":
      return { ...state, candidates: action.candidates };
    case "SELECT_CANDIDATE":
      return {
        ...state,
        selectedCandidateId: action.id,
        selectedCandidateIds: [action.id],
        step: "offer",
      };
    case "TOGGLE_CANDIDATE_SELECT": {
      const current = state.selectedCandidateIds ?? [];
      const exists = current.includes(action.id);
      let next = exists ? current.filter((id) => id !== action.id) : [...current, action.id];
      if (next.length > 3) next = next.slice(-3);
      return { ...state, selectedCandidateIds: next };
    }
    case "SELECT_CANDIDATES":
      return {
        ...state,
        selectedCandidateIds: action.ids.slice(0, 3),
        selectedCandidateId: action.ids[0],
        step: "offer",
      };
    case "COMPLETE_HIRE":
      return {
        ...state,
        hiredEmployeeId: action.employeeId,
        hiredEmployeeIds: action.employeeIds ?? [action.employeeId],
        dmRoomId: action.dmRoomId,
        dmTopicId: action.dmTopicId,
        step: "success",
      };
    case "SET_PENDING_ROOM":
      return { ...state, pendingRoomAssignment: action.roomId };
    case "SET_GEN_STEP":
      return { ...state, genStep: action.genStep };
    case "SET_SUCCESS_STEP":
      return { ...state, successStep: action.successStep };
    case "TOGGLE_ADV":
      return {
        ...state,
        advOpen: { ...state.advOpen, [action.id]: !state.advOpen[action.id] },
      };
    case "SET_COMPARE":
      return { ...state, compareOpen: action.open };
    case "SET_INTERVIEW":
      return { ...state, interviewWith: action.id };
    case "SET_INTERVIEW_MSGS":
      return {
        ...state,
        interviewMsgs: { ...state.interviewMsgs, [action.id]: action.messages },
      };
    case "SET_BUSY":
      return { ...state, busy: action.busy };
    case "SET_ERROR":
      return { ...state, error: action.error };
    case "SET_BRIEF_EDITABLE":
      return { ...state, briefEditable: action.editable };
    case "SET_REGEN_SPIN":
      return { ...state, regenSpin: action.spin };
    case "RESET_RECRUITER":
      return {
        ...state,
        recruiterMessages: [],
        checklist: emptyChecklist(),
        readiness: EMPTY_READINESS,
        suggestionChips: [],
        brief: undefined,
        briefPartial: undefined,
        briefReady: false,
        briefEditable: false,
        candidates: [],
        selectedCandidateId: undefined,
        discoveryStep: state.discoveryMode ? state.discoveryStep : null,
      };
    case "RESET_FOR_ROLE":
      return {
        ...initialHiringSession(),
        step: "recruiter",
        roleKey: action.roleKey,
        roleInput: action.roleInput,
        customRoleTitle: action.roleTitle,
        departmentId: action.departmentId ?? legacyDepartmentIdForRole(action.roleKey),
        sessionSource: state.sessionSource,
        hiringTopicId: state.hiringTopicId,
        inferenceConfidence: null,
        suggestedRoleKeys: action.roleKey ? [action.roleKey] : [],
        roleSetAt: new Date().toISOString(),
      };
    case "RESTORE":
      return action.state;
    default:
      return state;
  }
}

export function persistHiringSession(state: HiringSessionState, scope?: HiringSessionScope) {
  if (typeof window === "undefined") return;
  try {
    const { busy, regenSpin, compareOpen, interviewWith, ...rest } = state;
    void busy;
    void regenSpin;
    void compareOpen;
    void interviewWith;
    const key = scope ? hiringSessionStorageKey(scope) : HIRING_SESSION_KEY;
    sessionStorage.setItem(key, JSON.stringify(rest));
  } catch {
    /* ignore */
  }
}

export function normalizeRestoredHiringSession(
  state: HiringSessionState,
  opts?: { dmFirst?: boolean },
): HiringSessionState {
  let next = state;

  if (next.hiredEmployeeId) {
    if (next.step === "success" || !isPostHireHiringStep(next.step)) {
      next = { ...next, step: "assign_optional" };
    }
    return next;
  }

  if (opts?.dmFirst && next.recruiterMessages.length > 0 && next.step === "role") {
    next = { ...next, step: "recruiter" };
  }
  if (next.candidates.length > 0 && ["role", "recruiter", "brief", "generating_applicants"].includes(next.step)) {
    next = { ...next, step: "shortlist" };
  } else if (next.recruiterMessages.length > 0 && next.step === "role") {
    next = { ...next, step: "recruiter" };
  } else if ((next.brief || next.briefReady) && next.step === "role") {
    next = { ...next, step: "recruiter" };
  }
  return next;
}

export function loadHiringSession(opts?: {
  dmFirst?: boolean;
  scope?: HiringSessionScope;
}): HiringSessionState | null {
  if (typeof window === "undefined") return null;
  try {
    const key = opts?.scope ? hiringSessionStorageKey(opts.scope) : HIRING_SESSION_KEY;
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<HiringSessionState>;
    const base = { ...initialHiringSession(), ...parsed };
    if (!base.roleKey && base.departmentId) {
      const migrated = migrateLegacyDepartmentId(base.departmentId, base.roleInput);
      if (migrated) {
        base.roleKey = migrated;
      }
    }
    return normalizeRestoredHiringSession(base, opts);
  } catch {
    return null;
  }
}

export function clearHiringSession(scope?: HiringSessionScope) {
  if (typeof window === "undefined") return;
  const key = scope ? hiringSessionStorageKey(scope) : HIRING_SESSION_KEY;
  sessionStorage.removeItem(key);
}
