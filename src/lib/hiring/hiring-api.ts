import { authHeaders } from "@/lib/api/auth-client";
import type {
  AiEmployeeJobBrief,
  CandidatesApiResponse,
  RecruiterApiResponse,
} from "@/lib/hiring/types";

export type HiringApiContext = {
  workspaceId?: string | null;
  hiringSessionId?: string | null;
  topicId?: string | null;
  mayaRoomId?: string | null;
};

// Custom / refine turns can legitimately take longer; library-role chat should
// usually finish via the rule path well under this. Keep a human-scale ceiling
// so Maya never flashes a timeout while a draft is already ready.
const HIRING_REQUEST_TIMEOUT_MS = 45_000;

async function fetchHiringApi(path: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), HIRING_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(path, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Maya took too long to respond. Your draft has been saved; you can continue or try again.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function hiringContextPayload(context?: HiringApiContext): Record<string, unknown> {
  if (!context) return {};
  return {
    ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),
    ...(context.hiringSessionId ? { hiringSessionId: context.hiringSessionId } : {}),
    ...(context.topicId ? { topicId: context.topicId } : {}),
    ...(context.mayaRoomId ? { mayaRoomId: context.mayaRoomId } : {}),
  };
}

export async function callRecruiter(
  payload: Record<string, unknown>,
  context?: HiringApiContext,
): Promise<RecruiterApiResponse> {
  const headers = await authHeaders();
  const res = await fetchHiringApi("/api/hiring/recruiter", {
    method: "POST",
    headers,
    body: JSON.stringify({ ...payload, ...hiringContextPayload(context) }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? "Recruiter unavailable");
  }
  return res.json();
}

export async function callCandidates(
  brief: AiEmployeeJobBrief,
  departmentId: string | null,
  roleKey?: string | null,
  context?: HiringApiContext,
): Promise<CandidatesApiResponse> {
  const headers = await authHeaders();
  const res = await fetchHiringApi("/api/hiring/candidates", {
    method: "POST",
    headers,
    body: JSON.stringify({
      brief,
      departmentId,
      roleKey,
      ...hiringContextPayload(context),
    }),
  });
  if (!res.ok) throw new Error("Could not generate candidates");
  return res.json();
}

export type CandidateInterviewResponse = {
  reply: string;
  usedFallback?: boolean;
};

export async function callCandidateInterview(
  payload: {
    applicant: import("./types").AiEmployeeApplicant;
    brief: AiEmployeeJobBrief;
    conversation: import("./types").RecruiterMessage[];
    question: string;
  },
  context?: HiringApiContext,
): Promise<CandidateInterviewResponse> {
  const headers = await authHeaders();
  const res = await fetchHiringApi("/api/hiring/interview", {
    method: "POST",
    headers,
    body: JSON.stringify({ ...payload, ...hiringContextPayload(context) }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? "Interview unavailable");
  }
  return res.json();
}
