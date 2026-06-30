import type {
  AiEmployeeApplicant,
  AiEmployeeJobBrief,
  HiringSessionState,
  HiringStep,
  RecruiterChecklist,
  RecruiterMessage,
} from "./types";
import { emptyChecklist } from "./recruiter-checklist";

export const HIRING_SESSION_KEY = "adehq-hiring-session";

export function initialHiringSession(): HiringSessionState {
  return {
    step: "role",
    roleInput: "",
    departmentId: null,
    recruiterMessages: [],
    checklist: emptyChecklist(),
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
  | { type: "ADD_MESSAGE"; message: RecruiterMessage }
  | { type: "SET_MESSAGES"; messages: RecruiterMessage[] }
  | { type: "SET_CHECKLIST"; checklist: RecruiterChecklist }
  | { type: "SET_BRIEF"; brief: AiEmployeeJobBrief }
  | { type: "SET_BRIEF_PARTIAL"; briefPartial: Partial<AiEmployeeJobBrief> }
  | { type: "SET_BRIEF_READY"; briefReady: boolean }
  | { type: "SET_CANDIDATES"; candidates: AiEmployeeApplicant[] }
  | { type: "SELECT_CANDIDATE"; id: string }
  | { type: "COMPLETE_HIRE"; employeeId: string; dmRoomId: string }
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

export function hiringReducer(state: HiringSessionState, action: HiringAction): HiringSessionState {
  switch (action.type) {
    case "SET_STEP":
      return { ...state, step: action.step, error: null };
    case "SET_ROLE_INPUT":
      return { ...state, roleInput: action.roleInput };
    case "SET_DEPARTMENT":
      return { ...state, departmentId: action.departmentId };
    case "ADD_MESSAGE":
      return {
        ...state,
        recruiterMessages: [...state.recruiterMessages, action.message],
      };
    case "SET_MESSAGES":
      return { ...state, recruiterMessages: action.messages };
    case "SET_CHECKLIST":
      return { ...state, checklist: action.checklist };
    case "SET_BRIEF":
      return { ...state, brief: action.brief, briefPartial: action.brief };
    case "SET_BRIEF_PARTIAL":
      return { ...state, briefPartial: action.briefPartial };
    case "SET_BRIEF_READY":
      return { ...state, briefReady: action.briefReady };
    case "SET_CANDIDATES":
      return { ...state, candidates: action.candidates };
    case "SELECT_CANDIDATE":
      return { ...state, selectedCandidateId: action.id, step: "offer" };
    case "COMPLETE_HIRE":
      return {
        ...state,
        hiredEmployeeId: action.employeeId,
        dmRoomId: action.dmRoomId,
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
    case "RESTORE":
      return action.state;
    default:
      return state;
  }
}

export function persistHiringSession(state: HiringSessionState) {
  if (typeof window === "undefined") return;
  try {
    const { busy, regenSpin, compareOpen, interviewWith, ...rest } = state;
    void busy;
    void regenSpin;
    void compareOpen;
    void interviewWith;
    sessionStorage.setItem(HIRING_SESSION_KEY, JSON.stringify(rest));
  } catch {
    /* ignore */
  }
}

export function loadHiringSession(): HiringSessionState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(HIRING_SESSION_KEY);
    if (!raw) return null;
    return { ...initialHiringSession(), ...JSON.parse(raw) };
  } catch {
    return null;
  }
}

export function clearHiringSession() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(HIRING_SESSION_KEY);
}
