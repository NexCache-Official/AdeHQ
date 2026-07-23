import type { AiParticipationMode } from "../types";

export type CallParticipationMode = "quiet" | "smart_assist" | "active" | "council";

export type ParticipationReason =
  | "explicit_mention"
  | "role_directed"
  | "current_owner"
  | "requested_group_opinion"
  | "critical_correction"
  | "ambiguous_classifier"
  | "human_only"
  | "mode_quiet"
  | "no_relevant_signal";

export type ParticipationAction = "abstain" | "silent_collaborator" | "request_floor";

export type AmbiguousParticipationClassifier = {
  classify(input: {
    utterance: string;
    employeeId: string;
    employeeName?: string;
    role?: string;
    workstreams: string[];
  }): Promise<"participate" | "abstain">;
};

export type ParticipationCandidate = {
  employeeId: string;
  employeeName?: string;
  role?: string;
  workstreams?: string[];
  isCurrentOwner?: boolean;
  isLead?: boolean;
};

export type ParticipationContext = {
  utterance: string;
  mode: CallParticipationMode | AiParticipationMode;
  candidate: ParticipationCandidate;
  humanOnly?: boolean;
  explicitMentionedEmployeeIds?: string[];
  directedRole?: string;
  currentWorkstream?: string;
  requestedGroupOpinion?: boolean;
  criticalCorrection?: boolean;
  classifier?: AmbiguousParticipationClassifier;
};

export type ParticipationDecision = {
  participate: boolean;
  action: ParticipationAction;
  reason: ParticipationReason;
  deterministic: boolean;
  priority: number;
};

const LEGACY_MODE_MAP: Record<AiParticipationMode, CallParticipationMode> = {
  silent_observer: "quiet",
  on_request: "smart_assist",
  advisor: "smart_assist",
  facilitator: "council",
  active: "active",
};

const PERSISTED_MODE_MAP: Record<CallParticipationMode, AiParticipationMode> = {
  quiet: "silent_observer",
  smart_assist: "on_request",
  active: "active",
  council: "facilitator",
};

export function normalizeParticipationMode(
  mode: CallParticipationMode | AiParticipationMode,
): CallParticipationMode {
  return mode in LEGACY_MODE_MAP
    ? LEGACY_MODE_MAP[mode as AiParticipationMode]
    : (mode as CallParticipationMode);
}

export function toPersistedParticipationMode(mode: CallParticipationMode): AiParticipationMode {
  return PERSISTED_MODE_MAP[mode];
}

function normalize(value: string | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function deterministicSignal(context: ParticipationContext): {
  reason: ParticipationReason;
  priority: number;
} | null {
  const candidate = context.candidate;
  if (context.explicitMentionedEmployeeIds?.includes(candidate.employeeId)) {
    return { reason: "explicit_mention", priority: 100 };
  }
  if (context.criticalCorrection) {
    return { reason: "critical_correction", priority: 95 };
  }
  if (normalize(context.directedRole) && normalize(context.directedRole) === normalize(candidate.role)) {
    return { reason: "role_directed", priority: 90 };
  }
  if (
    candidate.isCurrentOwner ||
    (normalize(context.currentWorkstream) &&
      (candidate.workstreams ?? []).some(
        (workstream) => normalize(workstream) === normalize(context.currentWorkstream),
      ))
  ) {
    return { reason: "current_owner", priority: 80 };
  }
  if (context.requestedGroupOpinion) {
    return { reason: "requested_group_opinion", priority: 70 };
  }
  return null;
}

function actionFor(
  mode: CallParticipationMode,
  reason: ParticipationReason,
  isLead: boolean,
): ParticipationAction {
  if (mode === "council" && reason === "requested_group_opinion" && !isLead) {
    return "silent_collaborator";
  }
  return "request_floor";
}

/**
 * Deterministic signals always win. The optional classifier is deliberately
 * tiny and is consulted only when no explicit product signal resolved the turn.
 */
export async function decideParticipation(
  context: ParticipationContext,
): Promise<ParticipationDecision> {
  if (context.humanOnly) {
    return {
      participate: false,
      action: "abstain",
      reason: "human_only",
      deterministic: true,
      priority: 0,
    };
  }

  const mode = normalizeParticipationMode(context.mode);
  const signal = deterministicSignal(context);
  if (signal) {
    if (mode === "quiet" && signal.reason !== "explicit_mention") {
      return {
        participate: false,
        action: "abstain",
        reason: "mode_quiet",
        deterministic: true,
        priority: 0,
      };
    }
    const action = actionFor(mode, signal.reason, Boolean(context.candidate.isLead));
    return {
      participate: true,
      action,
      reason: signal.reason,
      deterministic: true,
      priority: signal.priority,
    };
  }

  if (mode === "quiet" || !context.classifier) {
    return {
      participate: false,
      action: "abstain",
      reason: mode === "quiet" ? "mode_quiet" : "no_relevant_signal",
      deterministic: true,
      priority: 0,
    };
  }

  try {
    const classified = await context.classifier.classify({
      utterance: context.utterance,
      employeeId: context.candidate.employeeId,
      employeeName: context.candidate.employeeName,
      role: context.candidate.role,
      workstreams: context.candidate.workstreams ?? [],
    });
    if (classified === "participate") {
      return {
        participate: true,
        action: mode === "council" && !context.candidate.isLead
          ? "silent_collaborator"
          : "request_floor",
        reason: "ambiguous_classifier",
        deterministic: false,
        priority: 50,
      };
    }
  } catch {
    // Classifier failure is intentionally fail-quiet.
  }

  return {
    participate: false,
    action: "abstain",
    reason: "no_relevant_signal",
    deterministic: true,
    priority: 0,
  };
}
