import type {
  AIEmployee,
  ConversationMode,
  ConversationParticipant,
  ConversationPlan,
  MentionRef,
  ProjectRoom,
  ResponseReason,
  RoomTopic,
} from "@/lib/types";
import type { ChannelGovernanceContext } from "@/lib/server/channel-governance";
import {
  isBroadcastToEveryone,
  isGroupGreeting,
  isRoomCooldownActive,
  pickGreetingEmployee,
} from "@/lib/server/channel-governance";
import { getEffectiveParticipationMode, filterAllowedEmployees } from "@/lib/topic-ai-control";
import { isGeneralTopic } from "@/lib/topics";
import { pickSmartResponders } from "@/lib/server/smart-participation";
import { extractMentionsInOrder, uid } from "@/lib/utils";
import type { ResponderDecision } from "@/lib/server/decide-responders";

const LEAD_COLLAB_PATTERNS = [
  /\bwork with\b/i,
  /\bcoordinate with\b/i,
  /\bcollaborate with\b/i,
  /\bteam up with\b/i,
  /\bpartner with\b/i,
  /\bloop in\b/i,
  /\bbring in\b/i,
  /\bwith help from\b/i,
  /\buse @\w+ to help\b/i,
];

const SEQUENTIAL_PATTERNS = [
  /\bthen @/i,
  /\bafter @/i,
  /\bonce @/i,
  /\bwhen @\w+ is done\b/i,
  /,\s*then @/i,
];

const PANEL_PATTERNS = [
  /\bwhat do you (both|all) think\b/i,
  /\bgive me both perspectives\b/i,
  /\bcompare your views\b/i,
  /\bI want input from both\b/i,
  /\beveryone weigh in\b/i,
  /\bthoughts from both\b/i,
  /\byour (combined |joint )?thoughts\b/i,
];

const SILENT_PATTERNS = [
  /\bleaving this\b/i,
  /\bnote for tomorrow\b/i,
  /\bjust noting\b/i,
  /\bfor the record\b/i,
];

export function classifyConversationMode(
  content: string,
  mentionedInOrder: AIEmployee[],
): ConversationMode {
  const text = content.trim();
  if (!mentionedInOrder.length) return "ambient_smart";
  if (mentionedInOrder.length === 1) return "direct_reply";

  if (SEQUENTIAL_PATTERNS.some((p) => p.test(text))) {
    return "lead_collaborator";
  }
  if (LEAD_COLLAB_PATTERNS.some((p) => p.test(text))) {
    return "lead_collaborator";
  }
  if (PANEL_PATTERNS.some((p) => p.test(text))) {
    return "panel_response";
  }

  return "direct_reply";
}

function resolveMentionedEmployees(
  content: string,
  employees: AIEmployee[],
  mentionsJson?: MentionRef[],
): AIEmployee[] {
  const candidates = employees.map((e) => ({ id: e.id, name: e.name }));
  const ordered = extractMentionsInOrder(content, candidates);
  const byId = new Map(employees.map((e) => [e.id, e]));

  if (mentionsJson?.length) {
    for (const m of mentionsJson) {
      if (m.type === "ai_employee" && byId.has(m.id) && !ordered.some((o) => o.id === m.id)) {
        const emp = byId.get(m.id)!;
        ordered.push({ id: emp.id, name: emp.name });
      }
    }
  }

  return ordered.map((o) => byId.get(o.id)!).filter(Boolean);
}

function buildLeadCollaboratorPlan(
  mentionedInOrder: AIEmployee[],
  collaborationId: string,
  rootTriggerMessageId?: string,
): ConversationPlan {
  const lead = mentionedInOrder[0];
  const collaborators = mentionedInOrder.slice(1);

  const participants: ConversationParticipant[] = [
    { employeeId: lead.id, employeeName: lead.name, role: "lead" },
    ...collaborators.map((c) => ({
      employeeId: c.id,
      employeeName: c.name,
      role: "collaborator" as const,
      waitingOnEmployeeId: lead.id,
      waitingOnEmployeeName: lead.name,
    })),
  ];

  return {
    mode: "lead_collaborator",
    collaborationId,
    rootTriggerMessageId,
    status: "active",
    participants,
    pendingParticipants: participants.filter((p) => p.role === "collaborator"),
  };
}

function buildPanelPlan(
  mentionedInOrder: AIEmployee[],
  collaborationId: string,
  rootTriggerMessageId?: string,
): ConversationPlan {
  return {
    mode: "panel_response",
    collaborationId,
    rootTriggerMessageId,
    status: "active",
    participants: mentionedInOrder.map((e) => ({
      employeeId: e.id,
      employeeName: e.name,
      role: "lead" as const,
    })),
    pendingParticipants: [],
    staggerMs: 1500,
  };
}

export type PlanConversationOptions = {
  forceEmployeeIds?: string[];
  maxParallel?: number;
  governance?: ChannelGovernanceContext;
  rootTriggerMessageId?: string;
};

export function planConversation(
  content: string,
  topic: RoomTopic,
  room: ProjectRoom,
  employees: AIEmployee[],
  mentionsJson?: MentionRef[],
  options?: PlanConversationOptions,
): { plan: ConversationPlan; decisions: ResponderDecision[] } {
  const max = options?.maxParallel ?? 3;
  const participation = getEffectiveParticipationMode(topic);
  const isDM = room.kind === "dm";
  const allowed = filterAllowedEmployees(topic, employees);
  const governance = options?.governance;
  const collaborationId = `collab_${options?.rootTriggerMessageId ?? uid("collab")}`;

  if (options?.forceEmployeeIds?.length) {
    const forced = allowed.filter((e) => options.forceEmployeeIds!.includes(e.id)).slice(0, max);
    return {
      plan: {
        mode: "direct_reply",
        collaborationId,
        status: "active",
        participants: forced.map((e) => ({
          employeeId: e.id,
          employeeName: e.name,
          role: "lead",
        })),
        pendingParticipants: [],
      },
      decisions: forced.map((employee) => ({ employee, reason: "slash_command" })),
    };
  }

  if (SILENT_PATTERNS.some((p) => p.test(content))) {
    return {
      plan: {
        mode: "silent",
        collaborationId,
        status: "active",
        participants: [],
        pendingParticipants: [],
      },
      decisions: [],
    };
  }

  const mentionedInOrder = resolveMentionedEmployees(content, allowed, mentionsJson);

  if (mentionedInOrder.length > 0) {
    const mode = classifyConversationMode(content, mentionedInOrder);

    if (mode === "lead_collaborator") {
      const plan = buildLeadCollaboratorPlan(
        mentionedInOrder,
        collaborationId,
        options?.rootTriggerMessageId,
      );
      const lead = mentionedInOrder[0];
      const orchestratedCollaboratorIds = mentionedInOrder.slice(1).map((e) => e.id);
      return {
        plan,
        decisions: [
          {
            employee: lead,
            reason: "collaboration_lead",
            runMetadata: {
              collaborationId,
              conversationMode: "lead_collaborator",
              collaborationRole: "lead",
              collaborationStatus: "active",
              rootTriggerMessageId: options?.rootTriggerMessageId,
              participants: plan.participants,
              pendingCollaboratorIds: orchestratedCollaboratorIds,
              orchestratedCollaborators: orchestratedCollaboratorIds,
            },
          },
        ],
      };
    }

    if (mode === "panel_response") {
      const plan = buildPanelPlan(
        mentionedInOrder.slice(0, max),
        collaborationId,
        options?.rootTriggerMessageId,
      );
      return {
        plan,
        decisions: mentionedInOrder.slice(0, max).map((employee, index) => ({
          employee,
          reason: "panel_response" as ResponseReason,
          runMetadata: {
            collaborationId,
            conversationMode: "panel_response",
            collaborationRole: "lead",
            collaborationStatus: "active",
            participants: plan.participants,
            staggerMs: 1500,
            staggerIndex: index,
          },
        })),
      };
    }

    const employee = mentionedInOrder[0];
    return {
      plan: {
        mode: "direct_reply",
        collaborationId,
        rootTriggerMessageId: options?.rootTriggerMessageId,
        status: "active",
        participants: [{ employeeId: employee.id, employeeName: employee.name, role: "lead" }],
        pendingParticipants: [],
      },
      decisions: [{ employee, reason: "explicit_mention" }],
    };
  }

  if (participation === "silent_observation" || participation === "manual_only") {
    if (isDM && isGeneralTopic(topic)) {
      const dmEmployee = allowed.find((e) => e.id === room.dmEmployeeId) ?? allowed[0];
      if (dmEmployee) {
        return {
          plan: {
            mode: "direct_reply",
            collaborationId,
            status: "active",
            participants: [
              { employeeId: dmEmployee.id, employeeName: dmEmployee.name, role: "lead" },
            ],
            pendingParticipants: [],
          },
          decisions: [{ employee: dmEmployee, reason: "dm_default" }],
        };
      }
    }
    return {
      plan: { mode: "silent", collaborationId, status: "active", participants: [], pendingParticipants: [] },
      decisions: [],
    };
  }

  if (governance?.lastMessageSenderType === "ai" && !isDM) {
    return {
      plan: { mode: "silent", collaborationId, status: "active", participants: [], pendingParticipants: [] },
      decisions: [],
    };
  }

  if (isRoomCooldownActive(governance ?? {})) {
    return {
      plan: { mode: "silent", collaborationId, status: "active", participants: [], pendingParticipants: [] },
      decisions: [],
    };
  }

  if (isGroupGreeting(content) || (isBroadcastToEveryone(content) && isGeneralTopic(topic))) {
    const greeter = pickGreetingEmployee(allowed);
    if (greeter) {
      return {
        plan: {
          mode: "broadcast_social",
          collaborationId,
          status: "active",
          participants: [{ employeeId: greeter.id, employeeName: greeter.name, role: "lead" }],
          pendingParticipants: [],
        },
        decisions: [{ employee: greeter, reason: "group_greeting", isGreetingRun: true }],
      };
    }
  }

  const smart = pickSmartResponders(content, allowed, participation, max);
  if (smart.length) {
    return {
      plan: {
        mode: "ambient_smart",
        collaborationId,
        status: "active",
        participants: smart.map((e) => ({
          employeeId: e.id,
          employeeName: e.name,
          role: "lead" as const,
        })),
        pendingParticipants: [],
      },
      decisions: smart.map((employee) => ({
        employee,
        reason: "smart_assist_role_match" as const,
      })),
    };
  }

  if (isDM && isGeneralTopic(topic)) {
    const dmEmployee = allowed.find((e) => e.id === room.dmEmployeeId) ?? allowed[0];
    if (dmEmployee) {
      return {
        plan: {
          mode: "direct_reply",
          collaborationId,
          status: "active",
          participants: [
            { employeeId: dmEmployee.id, employeeName: dmEmployee.name, role: "lead" },
          ],
          pendingParticipants: [],
        },
        decisions: [{ employee: dmEmployee, reason: "dm_default" }],
      };
    }
  }

  return {
    plan: { mode: "silent", collaborationId, status: "active", participants: [], pendingParticipants: [] },
    decisions: [],
  };
}

export function decisionsFromPlan(plan: ConversationPlan, decisions: ResponderDecision[]): ResponderDecision[] {
  return decisions;
}
