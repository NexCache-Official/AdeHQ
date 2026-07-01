import type { ResponderDecision } from "@/lib/server/decide-responders";
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
  if (intent === "panel_response" && role === "panelist") return "reviewer";
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
      return "panel_response";
    case "lead_collaborator":
      return "lead_collaborator";
    case "handoff":
      return "handoff";
    case "ambient_smart_assist":
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
  if (intent === "panel_response") return "panel_response";
  if (intent === "lead_collaborator") {
    return role === "lead" ? "collaboration_lead" : "collaboration_collaborator";
  }
  if (intent === "handoff") return role === "lead" ? "collaboration_lead" : "handoff";
  if (intent === "ambient_smart_assist") {
    return role === "lead" ? "ambient_collaboration_lead" : "ambient_collaboration_collaborator";
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

  const leadOnlyModes: OrchestrationPlan["intent"][] = [
    "lead_collaborator",
    "handoff",
    "ambient_smart_assist",
    "panel_response",
  ];

  if (
    leadOnlyModes.includes(plan.intent) &&
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
