import {
  isBroadcastToEveryone,
  isGroupGreeting,
  isLowActionMessage,
  pickGreetingEmployee,
} from "@/lib/server/room-governance";
import { isHelpRequest } from "@/lib/server/ambient-collaboration";
import { extractMentionsInOrder } from "@/lib/utils";
import { filterOrchestrationEmployees } from "./collaboration-permissions";
import { rankEmployeesForMessage, topEmployeesForMessage } from "./employee-relevance";
import { buildResponseOrderFromSelection, maybeEnhanceWithLlm } from "./llm-classifier";
import type { ClassifierGenerationOptions } from "./llm-classifier";
import {
  employeesFromReferenceIds,
  isMultiEmployeeCollaborationRequest,
  resolveParticipantReferences,
} from "./participant-reference-resolver";
import { classifyRoomMessageWithSteward } from "./room-steward";
import type {
  AIEmployeeProfile,
  OrchestrationIntent,
  OrchestrationPlan,
  OrchestratorInput,
  RoomStewardDecision,
  SuggestedConversationAction,
} from "./types";

const PANEL_PATTERNS = [
  /\bwhat do you (both|all) think\b/i,
  /\bthoughts\??\b/i,
  /\bopinions?\b/i,
  /\bcompare\b/i,
  /\bboth of you\b/i,
  /\beach of you\b/i,
  /\bpanel\b/i,
  /\byour (combined |joint )?thoughts\b/i,
];

const LEAD_COLLAB_PATTERNS = [
  /\bwork with\b/i,
  /\bcollaborate with\b/i,
  /\bhelp each other\b/i,
  /\btogether with\b/i,
  /\bpartner with\b/i,
  /\bcoordinate with\b/i,
  /\bteam up with\b/i,
  /\bloop in\b/i,
];

const HANDOFF_PATTERNS = [
  /\bpass this to\b/i,
  /\bhand (this |it )?off\b/i,
  /\bask .+ to continue\b/i,
  /\btransfer to\b/i,
  /\bget .+ to look\b/i,
  /\bcan you pass\b/i,
  /\bhand over to\b/i,
];

const SILENT_NOTE_PATTERNS = [
  /\bnote to self\b/i,
  /\bremind myself\b/i,
  /\bjust noting\b/i,
  /\bfor the record\b/i,
  /\bleaving this here\b/i,
  /\bnote for tomorrow\b/i,
];

const SOCIAL_THANKS_PATTERNS = [
  /^(thanks|thank you|thx|cheers)[!.?]*$/i,
  /^(ok|okay|got it|sounds good|cool|great|perfect)[!.?]*$/i,
];

function resolveMentionedEmployees(
  messageText: string,
  employees: AIEmployeeProfile[],
  mentionedEmployeeIds: string[],
): AIEmployeeProfile[] {
  const byId = new Map(employees.map((e) => [e.id, e]));
  if (mentionedEmployeeIds.length) {
    return mentionedEmployeeIds.map((id) => byId.get(id)).filter(Boolean) as AIEmployeeProfile[];
  }
  const ordered = extractMentionsInOrder(
    messageText,
    employees.map((e) => ({ id: e.id, name: e.name })),
  );
  return ordered.map((o) => byId.get(o.id)!).filter(Boolean);
}

function emptyPlan(intent: OrchestrationIntent, reason: string, confidence = 0.9): OrchestrationPlan {
  return {
    intent,
    confidence,
    reason,
    selectedEmployeeIds: [],
    leadEmployeeId: null,
    collaboratorEmployeeIds: [],
    shouldRespond: false,
    responseOrder: [],
    suggestedActions: [],
    workLogRequired: false,
    workLogReason: null,
  };
}

function employeeSummary(employee: AIEmployeeProfile): string {
  return [
    employee.role,
    employee.instructions,
    employee.metadata ? JSON.stringify(employee.metadata).slice(0, 240) : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function stewardDecisionToPlan(
  decision: RoomStewardDecision,
  employees: AIEmployeeProfile[],
): OrchestrationPlan {
  const byId = new Map(employees.map((employee) => [employee.id, employee]));
  const selected = decision.selectedEmployeeIds.filter((id) => byId.has(id));
  const lead = selected[0] ?? null;
  const collaborators = selected.slice(1);
  const suggestedActions: SuggestedConversationAction[] = decision.offerOnlyEmployeeIds
    .filter((id) => byId.has(id))
    .map((employeeId) => ({
      type: "invite_employee" as const,
      employeeId,
      employeeName: byId.get(employeeId)?.name,
      reason:
        decision.responseStyle === "offer_help"
          ? `${byId.get(employeeId)?.name ?? "This employee"} can offer help without taking over.`
          : decision.reason,
      confidence: decision.confidence,
    }));

  return {
    intent: decision.intent,
    confidence: decision.confidence,
    reason: decision.reason,
    selectedEmployeeIds: selected,
    offerOnlyEmployeeIds: decision.offerOnlyEmployeeIds,
    leadEmployeeId: lead,
    collaboratorEmployeeIds: collaborators,
    shouldRespond: decision.shouldRespond && selected.length > 0,
    responseStyle: decision.responseStyle,
    responseOrder: buildResponseOrderFromSelection(
      decision.intent,
      selected,
      lead,
      collaborators,
    ),
    suggestedActions,
    workLogRequired: false,
    workLogReason: null,
    pendingQuestionUpdates: decision.pendingQuestionUpdates,
    newPendingQuestions: decision.newPendingQuestions,
    suppressedEmployeeIds: decision.suppressedEmployeeIds,
    participation: decision.participation,
    costPolicy: decision.costPolicy,
    stewardDecision: decision,
  };
}

function planWithEmployees(
  intent: OrchestrationIntent,
  reason: string,
  employees: AIEmployeeProfile[],
  opts?: {
    confidence?: number;
    lead?: AIEmployeeProfile;
    collaborators?: AIEmployeeProfile[];
    workLogRequired?: boolean;
    workLogReason?: string;
    suggestedActions?: SuggestedConversationAction[];
  },
): OrchestrationPlan {
  const lead = opts?.lead ?? employees[0];
  const collaborators = opts?.collaborators ?? employees.slice(1);
  const selectedEmployeeIds = lead
    ? [lead.id, ...collaborators.map((e) => e.id)]
    : employees.map((e) => e.id);

  return {
    intent,
    confidence: opts?.confidence ?? 0.9,
    reason,
    selectedEmployeeIds,
    leadEmployeeId: lead?.id ?? null,
    collaboratorEmployeeIds: collaborators.map((e) => e.id),
    shouldRespond: selectedEmployeeIds.length > 0,
    responseOrder: buildResponseOrderFromSelection(
      intent,
      selectedEmployeeIds,
      lead?.id,
      collaborators.map((e) => e.id),
    ),
    suggestedActions: opts?.suggestedActions ?? [],
    workLogRequired: Boolean(opts?.workLogRequired),
    workLogReason: opts?.workLogReason ?? null,
  };
}

export function orchestrateConversationDeterministic(
  input: OrchestratorInput,
): OrchestrationPlan {
  const text = input.messageText.trim();
  const employees = filterOrchestrationEmployees(
    input.topicEmployees.length ? input.topicEmployees : input.roomEmployees,
  );

  if (input.isMayaDm || input.isMayaHiringSession) {
    return emptyPlan("silent_note", "Maya DM — specialized client flow handles responses.");
  }

  if (input.isDm) {
    if (!text || SILENT_NOTE_PATTERNS.some((p) => p.test(text))) {
      const actions: SuggestedConversationAction[] = [];
      if (/\bnote to self\b/i.test(text) || /\bremind myself\b/i.test(text)) {
        actions.push({
          type: "save_memory",
          text,
          reason: "This looks like a personal note you may want to save.",
          confidence: 0.72,
        });
      }
      return {
        ...emptyPlan("silent_note", "Personal note — no AI reply.", 0.92),
        suggestedActions: actions,
      };
    }

    const dmEmployee =
      (input.dmEmployeeId && employees.find((e) => e.id === input.dmEmployeeId)) ??
      (employees.length === 1 ? employees[0] : undefined);

    if (!dmEmployee) {
      return emptyPlan("silent_note", "DM has no eligible AI employee to reply.", 0.85);
    }

    return planWithEmployees(
      "direct_reply",
      "Direct message — assigned employee replies.",
      [dmEmployee],
      {
        confidence: 0.95,
        workLogRequired: false,
      },
    );
  }

  if (!text || SILENT_NOTE_PATTERNS.some((p) => p.test(text)) || SOCIAL_THANKS_PATTERNS.some((p) => p.test(text))) {
    const actions: SuggestedConversationAction[] = [];
    if (/\bnote to self\b/i.test(text) || /\bremind myself\b/i.test(text)) {
      actions.push({
        type: "save_memory",
        text,
        reason: "This looks like a personal note you may want to save.",
        confidence: 0.72,
      });
    }
    return {
      ...emptyPlan("silent_note", "Personal note or acknowledgement — no AI reply.", 0.92),
      suggestedActions: actions,
    };
  }

  if (isGroupGreeting(text) || isBroadcastToEveryone(text)) {
    const greeter = pickGreetingEmployee(employees as Parameters<typeof pickGreetingEmployee>[0]);
    if (!greeter) return emptyPlan("social_broadcast", "No eligible employee for greeting.", 0.8);
    return planWithEmployees("social_broadcast", "Social greeting — one concise reply.", [greeter], {
      confidence: 0.95,
      workLogRequired: false,
    });
  }

  const mentionedByAt = resolveMentionedEmployees(text, employees, input.mentionedEmployeeIds);
  const nameRefs = resolveParticipantReferences(text, employees, {
    excludeEmployeeIds: mentionedByAt.map((employee) => employee.id),
  });
  const mentionedByName = employeesFromReferenceIds(employees, nameRefs.actionableEmployeeIds);
  const mentioned = [
    ...mentionedByAt,
    ...mentionedByName.filter((employee) => !mentionedByAt.some((m) => m.id === employee.id)),
  ];

  if (mentioned.length === 0 && isMultiEmployeeCollaborationRequest(text)) {
    const ranked = topEmployeesForMessage(text, employees, 2);
    if (ranked.length >= 2 && input.smartAssistEnabled) {
      const selected = ranked
        .map((row) => employees.find((employee) => employee.id === row.employeeId))
        .filter(Boolean) as AIEmployeeProfile[];
      if (selected.length >= 2) {
        return planWithEmployees(
          "lead_collaborator",
          "Multi-employee collaboration request — lead and collaborator assigned.",
          selected.slice(0, 2),
          {
            confidence: 0.88,
            lead: selected[0],
            collaborators: [selected[1]],
            workLogRequired: false,
          },
        );
      }
    }
  }

  if (mentioned.length > 0) {
    if (HANDOFF_PATTERNS.some((p) => p.test(text)) && mentioned.length >= 2) {
      return planWithEmployees(
        "handoff",
        "Explicit handoff between mentioned employees.",
        mentioned,
        {
          confidence: 0.9,
          lead: mentioned[0],
          collaborators: [mentioned[1]],
          workLogRequired: false,
        },
      );
    }

    if (LEAD_COLLAB_PATTERNS.some((p) => p.test(text)) && mentioned.length >= 2) {
      return planWithEmployees(
        "lead_collaborator",
        "Lead/collaborator coordination requested.",
        mentioned,
        {
          confidence: 0.9,
          lead: mentioned[0],
          collaborators: mentioned.slice(1),
          workLogRequired: false,
        },
      );
    }

    if (PANEL_PATTERNS.some((p) => p.test(text)) && mentioned.length >= 2) {
      return planWithEmployees("panel_response", "Panel response requested.", mentioned, {
        confidence: 0.9,
        workLogRequired: false,
      });
    }

    if (mentioned.length === 1) {
      return planWithEmployees("direct_reply", "Direct mention — single employee replies.", mentioned, {
        confidence: 0.95,
        workLogRequired: false,
      });
    }

    return planWithEmployees("direct_reply", "Multiple mentions without panel signal — first mentioned replies.", [
      mentioned[0],
    ], {
      confidence: 0.78,
      workLogRequired: false,
    });
  }

  if (isHelpRequest(text) || /\bneed help\b/i.test(text)) {
    const ranked = topEmployeesForMessage(text, employees, 3);
    if (!ranked.length) {
      return emptyPlan("ambient_smart_assist", "Help request but no relevant employees.", 0.7);
    }

    const selected = ranked
      .slice(0, ranked.length >= 2 && ranked[1].score >= ranked[0].score * 0.55 ? 2 : 1)
      .map((r) => employees.find((e) => e.id === r.employeeId)!)
      .filter(Boolean);

    if (!input.smartAssistEnabled) {
      return {
        ...emptyPlan("ambient_smart_assist", "Smart Assist disabled — suggest employees instead.", 0.88),
        suggestedActions: selected.map((employee) => ({
          type: "invite_employee" as const,
          employeeId: employee.id,
          employeeName: employee.name,
          reason: `Ask ${employee.name} to help with this.`,
          confidence: 0.85,
        })),
      };
    }

    return planWithEmployees(
      selected.length > 1 ? "lead_collaborator" : "ambient_smart_assist",
      "Ambient help request — relevant employees selected.",
      selected,
      {
        confidence: 0.82,
        lead: selected[0],
        collaborators: selected.slice(1),
        workLogRequired: false,
      },
    );
  }

  const ambientRanked = topEmployeesForMessage(text, employees, 1);
  if (input.smartAssistEnabled && ambientRanked.length && ambientRanked[0].score >= 10) {
    const employee = employees.find((e) => e.id === ambientRanked[0].employeeId)!;
    return planWithEmployees("ambient_smart_assist", ambientRanked[0].reason, [employee], {
      confidence: 0.76,
      workLogRequired: false,
    });
  }

  if (!input.smartAssistEnabled && ambientRanked.length && ambientRanked[0].score >= 10) {
    const employee = employees.find((e) => e.id === ambientRanked[0].employeeId)!;
    return {
      ...emptyPlan("ambient_smart_assist", "Smart Assist off — suggestion only.", 0.8),
      suggestedActions: [
        {
          type: "invite_employee",
          employeeId: employee.id,
          employeeName: employee.name,
          reason: `Ask ${employee.name} to help.`,
          confidence: 0.8,
        },
      ],
    };
  }

  return emptyPlan("silent_note", "No clear orchestration signal.", 0.85);
}

export type OrchestrateConversationOptions = Pick<
  ClassifierGenerationOptions,
  "client" | "sourceMessageCount"
>;

export async function orchestrateConversation(
  input: OrchestratorInput,
  options: OrchestrateConversationOptions = {},
): Promise<OrchestrationPlan> {
  const employees = filterOrchestrationEmployees(
    input.topicEmployees.length ? input.topicEmployees : input.roomEmployees,
  );

  if (
    !input.isDm &&
    !input.isMayaDm &&
    !input.isMayaHiringSession &&
    input.topicId &&
    input.topicState &&
    input.participationMode
  ) {
    const stewardDecision = await classifyRoomMessageWithSteward({
      workspaceId: input.workspaceId,
      roomId: input.roomId,
      topicId: input.topicId,
      messageId: input.messageId,
      messageContent: input.messageText,
      authorType: "human",
      mentionedEmployeeIds: input.mentionedEmployeeIds,
      mentionedHumanIds: input.mentionedHumanIds,
      participationMode: input.participationMode,
      roster: employees.map((employee) => ({
        employeeId: employee.id,
        name: employee.name,
        roleTitle: employee.role,
        roleKey: employee.roleKey,
        expertiseSummary: employeeSummary(employee),
        intelligencePolicy: employee.intelligencePolicy,
        isActiveInTopic: input.topicState?.activeEmployeeIds.includes(employee.id) ?? false,
      })),
      recentMessages: input.recentMessages
        .filter((message) => message.senderType === "human" || message.senderType === "ai")
        .map((message) => ({
          id: message.id,
          authorType: message.senderType as "human" | "ai",
          authorName:
            employees.find((employee) => employee.id === message.senderId)?.name ??
            (message.senderType === "human" ? "Human" : "AI"),
          employeeId: message.senderType === "ai" && message.senderId ? message.senderId : undefined,
          content: message.text,
          createdAt: message.createdAt,
        })),
      topicState: input.topicState,
    });
    return stewardDecisionToPlan(stewardDecision, employees);
  }

  const deterministic = orchestrateConversationDeterministic(input);
  if (deterministic.confidence >= 0.75 || !employees.length) {
    return deterministic;
  }
  return maybeEnhanceWithLlm(input, employees, deterministic, options);
}

export { rankEmployeesForMessage };
