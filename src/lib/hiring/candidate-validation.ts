import type { AiEmployeeApplicant } from "./types";

/**
 * PART 4 — Candidate generation correctness.
 *
 * Guards against stale cross-role candidate reuse (e.g. a Software Engineer
 * session ever showing Sales Development Rep candidates). Candidates are
 * validated against the current session's role before they are rendered or
 * hired; mismatches are treated as stale and cleared.
 */

export type CandidateSessionContext = {
  sessionId?: string | null;
  roleKey: string | null;
  roleTitle: string | null;
  /** ISO timestamp when the session role was last set/refreshed */
  roleSetAt?: string | null;
};

export type CandidateValidationFailure =
  | "session_mismatch"
  | "role_key_mismatch"
  | "role_title_mismatch"
  | "generated_before_role_set";

export function normalizeRoleTitle(title?: string | null): string {
  return (title ?? "").trim().toLowerCase();
}

const SENIORITY_PREFIX = /^(senior|junior|lead|principal|staff|entry[-\s]?level|sr\.?|jr\.?)\s+/i;

/**
 * Role titles are compatible when they normalize to the same base title,
 * allowing seniority-prefixed aliases (e.g. "Senior Software Engineer" is
 * compatible with "Software Engineer"). When either title is missing we cannot
 * disprove compatibility, so we allow it and rely on the role_key check.
 */
export function roleTitlesCompatible(a?: string | null, b?: string | null): boolean {
  const na = normalizeRoleTitle(a);
  const nb = normalizeRoleTitle(b);
  if (!na || !nb) return true;
  if (na === nb) return true;
  const strip = (s: string) => s.replace(SENIORITY_PREFIX, "").trim();
  const sa = strip(na);
  const sb = strip(nb);
  if (sa === sb && sa.length > 0) return true;
  return sa.includes(sb) || sb.includes(sa);
}

/**
 * Returns a failure reason when the candidate does not belong to the current
 * session/role, otherwise null when the candidate is valid.
 */
export function candidateValidationFailure(
  candidate: AiEmployeeApplicant,
  ctx: CandidateSessionContext,
): CandidateValidationFailure | null {
  if (ctx.sessionId && candidate.hiringSessionId && candidate.hiringSessionId !== ctx.sessionId) {
    return "session_mismatch";
  }
  if (ctx.roleKey && candidate.roleKey && candidate.roleKey !== ctx.roleKey) {
    return "role_key_mismatch";
  }
  if (!roleTitlesCompatible(candidate.roleTitle, ctx.roleTitle)) {
    return "role_title_mismatch";
  }
  if (ctx.roleSetAt && candidate.generatedAt) {
    const generated = Date.parse(candidate.generatedAt);
    const roleSet = Date.parse(ctx.roleSetAt);
    if (Number.isFinite(generated) && Number.isFinite(roleSet) && generated < roleSet) {
      return "generated_before_role_set";
    }
  }
  return null;
}

export function isCandidateValidForSession(
  candidate: AiEmployeeApplicant,
  ctx: CandidateSessionContext,
): boolean {
  return candidateValidationFailure(candidate, ctx) === null;
}

export type CandidateValidationResult = {
  valid: AiEmployeeApplicant[];
  stale: AiEmployeeApplicant[];
  isStale: boolean;
  reasons: CandidateValidationFailure[];
};

export function validateSessionCandidates(
  candidates: AiEmployeeApplicant[],
  ctx: CandidateSessionContext,
): CandidateValidationResult {
  const valid: AiEmployeeApplicant[] = [];
  const stale: AiEmployeeApplicant[] = [];
  const reasons = new Set<CandidateValidationFailure>();

  for (const candidate of candidates) {
    const failure = candidateValidationFailure(candidate, ctx);
    if (failure) {
      stale.push(candidate);
      reasons.add(failure);
    } else {
      valid.push(candidate);
    }
  }

  return {
    valid,
    stale,
    isStale: stale.length > 0,
    reasons: [...reasons],
  };
}

/** User-facing message shown after clearing stale candidates. */
export function staleCandidatesClearedMessage(roleTitle?: string | null): string {
  const role = roleTitle?.trim() ? roleTitle.trim() : "this role";
  return `These candidates were from an older hiring session, so I cleared them. Generate new ${role} candidates?`;
}

export type HireGuardFailure =
  | { ok: false; reason: CandidateValidationFailure | "not_in_session" | "already_hired" | "no_workspace"; message: string }
  | { ok: true };

/**
 * Verifies a candidate can be hired for the current session before claiming the
 * hire lock: candidate belongs to the session, role matches, not already hired,
 * and a workspace exists.
 */
export function guardHireCandidate(params: {
  candidate: AiEmployeeApplicant;
  sessionCandidates: AiEmployeeApplicant[];
  ctx: CandidateSessionContext;
  hiredEmployeeId?: string | null;
  workspaceId?: string | null;
}): HireGuardFailure {
  const { candidate, sessionCandidates, ctx, hiredEmployeeId, workspaceId } = params;

  if (hiredEmployeeId) {
    return {
      ok: false,
      reason: "already_hired",
      message: "This session already has a hired employee.",
    };
  }

  if (!workspaceId) {
    return {
      ok: false,
      reason: "no_workspace",
      message: "No active workspace — please reload before hiring.",
    };
  }

  const inSession = sessionCandidates.some((c) => c.id === candidate.id);
  if (!inSession) {
    return {
      ok: false,
      reason: "not_in_session",
      message: "That candidate is no longer part of this hiring session.",
    };
  }

  const failure = candidateValidationFailure(candidate, ctx);
  if (failure) {
    return {
      ok: false,
      reason: failure,
      message: "That candidate doesn't match this session's role.",
    };
  }

  return { ok: true };
}
