import type { OrchestrationIntent, OrchestrationPlan, OrchestrationResponseRole } from "./types";
import type { ConversationMode } from "@/lib/types";

export type OrchestrationPhase =
  | "planned"
  | "reading"
  | "replying"
  | "waiting"
  | "completed"
  | "failed";

const INTENT_MODE_LABEL: Record<OrchestrationIntent, string> = {
  silent_note: "Silent",
  social_broadcast: "Greeting",
  direct_reply: "Direct reply",
  panel_response: "Panel response",
  lead_collaborator: "Lead + collaborator",
  handoff: "Handoff",
  ambient_smart_assist: "Smart Assist",
  social_ack: "Acknowledgement",
  direct_question: "Direct question",
  answer_to_pending_question: "Continuing thread",
  task_request: "Task request",
  work_update: "Work update",
  ask_for_opinion: "Opinion request",
  handoff_response: "Handoff response",
  employee_followup_needed: "Follow-up needed",
  offer_help: "Offer help",
  multi_employee_collaboration: "Multi-employee collaboration",
  brainstorm: "Brainstorm",
  topic_shift: "Topic shift",
  correction_or_clarification: "Clarification",
};

const CONVERSATION_MODE_LABEL: Record<ConversationMode, string> = {
  direct_reply: "Direct reply",
  broadcast_social: "Greeting",
  panel_response: "Panel response",
  lead_collaborator: "Lead + collaborator",
  handoff: "Handoff",
  ambient_smart: "Smart Assist",
  ambient_collaboration: "Smart Assist",
  silent: "Silent",
};

export function orchestrationModeLabel(
  plan?: OrchestrationPlan | null,
  collaborationMode?: ConversationMode | null,
): string | null {
  if (plan?.intent && plan.intent !== "silent_note") {
    return INTENT_MODE_LABEL[plan.intent] ?? plan.intent;
  }
  if (collaborationMode && collaborationMode !== "silent") {
    return CONVERSATION_MODE_LABEL[collaborationMode] ?? collaborationMode;
  }
  return null;
}

export function orchestrationRoleLabel(
  role: OrchestrationResponseRole,
  intent: OrchestrationIntent,
  panelIndex?: number,
): string {
  if ((intent === "panel_response" || intent === "multi_employee_collaboration") && role === "panelist") {
    return `Panelist ${(panelIndex ?? 0) + 1}`;
  }
  if (intent === "handoff") {
    if (role === "lead") return "Handing off";
    return "Continuing";
  }
  if (intent === "social_broadcast" || role === "social") return "Greeting";
  if (role === "direct" || intent === "direct_reply") return "Responding";
  if (role === "lead") return "Lead";
  if (role === "collaborator") return "Collaborator";
  if (role === "panelist") return `Panelist ${(panelIndex ?? 0) + 1}`;
  return "Participant";
}

export function orchestrationPhaseLabel(
  phase: OrchestrationPhase,
  waitingOnEmployeeName?: string,
): string {
  switch (phase) {
    case "planned":
      return "Planned";
    case "reading":
      return "Reading";
    case "replying":
      return "Replying";
    case "waiting":
      return waitingOnEmployeeName
        ? `Waiting for ${waitingOnEmployeeName}`
        : "Waiting";
    case "completed":
      return "Replied";
    case "failed":
      return "Failed";
    default:
      return phase;
  }
}

export function shortEmployeeName(name: string): string {
  return name.replace(/\s+Employee$/i, "").trim() || name;
}

export function formatOrchestrationChipLabel(
  plan: OrchestrationPlan,
  employeeNames: Map<string, string>,
): string {
  const names = plan.selectedEmployeeIds
    .map((id) => shortEmployeeName(employeeNames.get(id) ?? "Employee"))
    .filter(Boolean);

  switch (plan.intent) {
    case "panel_response":
    case "multi_employee_collaboration":
      return names.length >= 2
        ? `Panel response · ${names.join(" + ")}`
        : `Panel response · ${names[0] ?? "team"}`;
    case "lead_collaborator": {
      const lead = plan.leadEmployeeId
        ? shortEmployeeName(employeeNames.get(plan.leadEmployeeId) ?? "Lead")
        : names[0];
      const collabs = (plan.collaboratorEmployeeIds ?? [])
        .map((id) => shortEmployeeName(employeeNames.get(id) ?? ""))
        .filter(Boolean);
      if (lead && collabs.length) {
        return `${lead} leading · ${collabs.join(", ")} collaborating`;
      }
      return "Lead + collaborator";
    }
    case "handoff":
      return names.length >= 2
        ? `Handoff · ${names[0]} → ${names[1]}`
        : "Handoff in progress";
    case "ambient_smart_assist":
      return names.length
        ? `Smart Assist selected ${names.join(", ")}`
        : "Smart Assist";
    case "answer_to_pending_question":
      return names[0] ? `${names[0]} continuing thread` : "Continuing thread";
    case "employee_followup_needed":
    case "correction_or_clarification":
      return names[0] ? `${names[0]} following up` : "Following up";
    case "brainstorm":
      return names.length
        ? `Brainstorm · ${names.slice(0, 2).join(" + ")}`
        : "Brainstorm";
    case "task_request":
    case "direct_question":
    case "ask_for_opinion":
      return names[0] ? `Smart Assist · ${names[0]}` : "Smart Assist";
    case "direct_reply":
      return names[0] ? `Direct reply · ${names[0]}` : "Direct reply";
    case "social_broadcast":
      return names[0] ? `Greeting · ${names[0]}` : "Greeting";
    default:
      return orchestrationModeLabel(plan) ?? "Orchestration";
  }
}

export function sidebarStatusLine(
  employeeName: string,
  roleLabel: string,
  phaseLabel: string,
  detail?: string,
): string {
  const base = `${employeeName} — ${roleLabel} · ${phaseLabel}`;
  return detail ? `${base} — ${detail}` : base;
}
