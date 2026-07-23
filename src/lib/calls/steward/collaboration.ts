import type { AiParticipationMode } from "../types";

export const DEFAULT_MAX_SILENT_COLLABORATORS = 4;

export type CouncilCandidate = {
  employeeId: string;
  participationMode: AiParticipationMode | null;
};

export type CouncilPlan = {
  leadEmployeeId: string;
  collaboratorEmployeeIds: string[];
  omittedEmployeeIds: string[];
  sharedListening: {
    transcriptStreams: 1;
    perAiListeningStreams: 0;
  };
};

const LEAD_MODE_RANK: Record<AiParticipationMode, number> = {
  facilitator: 0,
  on_request: 1,
  active: 2,
  advisor: 3,
  silent_observer: 4,
};

export function planCouncil(
  candidates: CouncilCandidate[],
  options?: { maxSilentCollaborators?: number },
): CouncilPlan {
  const unique = [
    ...new Map(candidates.map((candidate) => [candidate.employeeId, candidate])).values(),
  ];
  if (!unique.length) throw new Error("A council requires at least one invited AI employee.");
  const ranked = unique
    .map((candidate, index) => ({ candidate, index }))
    .sort(
      (left, right) =>
        LEAD_MODE_RANK[left.candidate.participationMode ?? "advisor"] -
          LEAD_MODE_RANK[right.candidate.participationMode ?? "advisor"] ||
        left.index - right.index,
    )
    .map(({ candidate }) => candidate);
  const [lead, ...others] = ranked;
  const cap = Math.max(
    0,
    options?.maxSilentCollaborators ?? DEFAULT_MAX_SILENT_COLLABORATORS,
  );
  return {
    leadEmployeeId: lead.employeeId,
    collaboratorEmployeeIds: others.slice(0, cap).map((candidate) => candidate.employeeId),
    omittedEmployeeIds: others.slice(cap).map((candidate) => candidate.employeeId),
    sharedListening: {
      transcriptStreams: 1,
      perAiListeningStreams: 0,
    },
  };
}
