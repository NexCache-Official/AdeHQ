import type { ResponderDecision } from "@/lib/server/conversation-orchestrator";
import type {
  ConversationMode,
  ConversationPlan,
  ResponseReason,
} from "@/lib/types";
import type { AIEmployee } from "@/lib/types";
import type { OrchestrationPlan, OrchestrationResponseRole } from "./types";

function mapParticipantRole(
  role: OrchestrationResponseRole,
  intent: OrchestrationPlan["intent"],
): "lead" | "collaborator" | "reviewer" | "observer" {
  if ((intent === "panel_response" || intent === "multi_employee_collaboration") && role === "panelist") return "reviewer";
  if (intent === "handoff" && role === "direct") return "collaborator";
  if (role === "collaborator") return "collaborator";
  if (role === "lead") return "lead";
  return "reviewer";
}

function mapIntentToMode(intent: OrchestrationPlan["intent"]): ConversationMode {
  switch (intent) {
    case "social_broadcast":
      return "broadcast_social";
    case "panel_response":
    case "multi_employee_collaboration":
      return "panel_response";
    case "lead_collaborator":
    case "answer_to_pending_question":
    case "employee_followup_needed":
    case "handoff_response":
    case "correction_or_clarification":
    case "offer_help":
      return "lead_collaborator";
    case "handoff":
      return "handoff";
    case "ambient_smart_assist":
    case "direct_question":
    case "task_request":
    case "ask_for_opinion":
      return "ambient_collaboration";
    case "direct_reply":
      return "direct_reply";
    default:
      return "silent";
  }
}

function mapRoleToReason(
  role: OrchestrationResponseRole,
  intent: OrchestrationPlan["intent"],
): ResponseReason {
  if (intent === "social_broadcast") return "group_greeting";
  if (intent === "panel_response" || intent === "multi_employee_collaboration") return "panel_response";
  if (
    intent === "lead_collaborator" ||
    intent === "answer_to_pending_question" ||
    intent === "employee_followup_needed" ||
    intent === "handoff_response" ||
    intent === "correction_or_clarification" ||
    intent === "offer_help"
  ) {
    return role === "lead" ? "collaboration_lead" : "collaboration_collaborator";
  }
  if (intent === "handoff") return role === "lead" ? "collaboration_lead" : "handoff";
  if (
    intent === "ambient_smart_assist" ||
    intent === "direct_question" ||
    intent === "task_request" ||
    intent === "ask_for_opinion"
  ) {
    return role === "collaborator" ? "ambient_collaboration_collaborator" : "ambient_collaboration_lead";
  }
  if (role === "collaborator") return "collaboration_collaborator";
  return "explicit_mention";
}

export function orchestrationPlanToLegacyResult(
  plan: OrchestrationPlan,
  employees: AIEmployee[],
  rootTriggerMessageId: string,
): {
  plan: ConversationPlan;
  decisions: ResponderDecision[];
} {
  const collaborationId = `collab_${rootTriggerMessageId}`;
  const byId = new Map(employees.map((e) => [e.id, e]));
  const mode = mapIntentToMode(plan.intent);

  if (!plan.shouldRespond || plan.responseOrder.length === 0) {
    return {
      plan: {
        mode: "silent",
        collaborationId,
        rootTriggerMessageId,
        status: "active",
        participants: [],
        pendingParticipants: [],
      },
      decisions: [],
    };
  }

  const firstOrder = plan.responseOrder[0];
  const leadEmployee = byId.get(firstOrder.employeeId);
  if (!leadEmployee) {
    return {
      plan: {
        mode: "silent",
        collaborationId,
        rootTriggerMessageId,
        status: "active",
        participants: [],
        pendingParticipants: [],
      },
      decisions: [],
    };
  }

  const pendingCollaboratorIds = plan.responseOrder
    .slice(1)
    .map((r) => r.employeeId)
    .filter((id) => byId.has(id));

  const participants = plan.responseOrder
    .filter((r) => byId.has(r.employeeId))
    .map((r, index) => ({
      employeeId: r.employeeId,
      employeeName: byId.get(r.employeeId)!.name,
      role: mapParticipantRole(r.role, plan.intent),
      waitingOnEmployeeId: index > 0 ? firstOrder.employeeId : undefined,
      waitingOnEmployeeName: index > 0 ? leadEmployee.name : undefined,
    }));

  const conversationPlan: ConversationPlan = {
    mode,
    collaborationId,
    rootTriggerMessageId,
    status: "active",
    participants,
    pendingParticipants: participants.filter((p) => p.waitingOnEmployeeId),
    staggerMs: plan.intent === "panel_response" ? 1500 : undefined,
  };

  // Intents where multiple employees answering in the same turn is the intended
  // behavior (simultaneous group greetings/acks) — every other intent with more
  // than one responder must be serialized below, or the collaborator(s) fire
  // with no visibility into the lead's answer and produce a full duplicate reply
  // instead of building on it (observed: two employees independently giving the
  // same research answer because "offer_help" was missing from the old
  // allowlist-based gate here — see AUDIT_REPORT.md).
  const simultaneousIntents: OrchestrationPlan["intent"][] = ["social_broadcast", "social_ack"];

  if (
    !simultaneousIntents.includes(plan.intent) &&
    pendingCollaboratorIds.length > 0
  ) {
    return {
      plan: conversationPlan,
      decisions: [
        {
          employee: leadEmployee,
          reason: mapRoleToReason(
            plan.intent === "panel_response" ? "panelist" : "lead",
            plan.intent,
          ),
          runMetadata: {
            collaborationId,
            conversationMode: mode,
            collaborationRole:
              plan.intent === "panel_response" ? "panelist" : "lead",
            collaborationStatus: "active",
            rootTriggerMessageId,
            participants,
            pendingCollaboratorIds,
            orchestratedCollaborators: pendingCollaboratorIds,
            orchestrationIntent: plan.intent,
            orchestrationConfidence: plan.confidence,
            orchestrationReason: plan.reason,
          },
        },
      ],
    };
  }

  const decisions: ResponderDecision[] = plan.responseOrder
    .filter((r) => byId.has(r.employeeId))
    .map((r, index) => ({
      employee: byId.get(r.employeeId)!,
      reason: mapRoleToReason(r.role, plan.intent),
      isGreetingRun: plan.intent === "social_broadcast",
      runMetadata: {
        collaborationId,
        conversationMode: mode,
        collaborationRole:
          r.role === "collaborator"
            ? "collaborator"
            : r.role === "panelist"
              ? "panelist"
              : "lead",
        collaborationStatus: "active",
        participants,
        staggerMs: r.delayMs ?? index * 1500,
        staggerIndex: index,
        orchestrationIntent: plan.intent,
        orchestrationConfidence: plan.confidence,
        orchestrationReason: plan.reason,
        ...(index === 0 && pendingCollaboratorIds.length
          ? {
              pendingCollaboratorIds,
              orchestratedCollaborators: pendingCollaboratorIds,
            }
          : {}),
      },
    }));

  return { plan: conversationPlan, decisions };
}
