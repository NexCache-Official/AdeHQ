import { authHeaders } from "@/lib/api/auth-client";
import type {
  AiEmployeeJobBrief,
  CandidatesApiResponse,
  RecruiterApiResponse,
} from "@/lib/hiring/types";

export async function callRecruiter(
  payload: Record<string, unknown>,
): Promise<RecruiterApiResponse> {
  const headers = await authHeaders();
  const res = await fetch("/api/hiring/recruiter", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
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
): Promise<CandidatesApiResponse> {
  const headers = await authHeaders();
  const res = await fetch("/api/hiring/candidates", {
    method: "POST",
    headers,
    body: JSON.stringify({ brief, departmentId, roleKey }),
  });
  if (!res.ok) throw new Error("Could not generate candidates");
  return res.json();
}
