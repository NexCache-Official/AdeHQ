import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { AuthError, requireAuthUser } from "@/lib/supabase/auth-server";
import { siliconFlowChatModel, siliconFlowProviderOptions } from "@/lib/ai/siliconflow-client";
import { resolveModel } from "@/lib/ai/model-catalog";
import { isSiliconFlowConfigured } from "@/lib/config/features";
import { briefSchema, recruiterResponseSchema } from "@/lib/hiring/brief-schema";
import {
  departmentLabel,
  mergeBriefPartial,
  synthesizeBriefForHiringContext,
} from "@/lib/hiring/build-brief";
import { applyChipMutation, READY_BRIEF_PHRASE, recruiterReadyMessage } from "@/lib/hiring/chip-mutations";
import { buildRecruiterOpeningMessage } from "@/lib/hiring/recruiter-openings";
import { applyRoleFocusAnswer } from "@/lib/hiring/role-focus-answers";
import { getRoleByKey } from "@/lib/hiring/role-library";
import {
  checklistFromBrief,
} from "@/lib/hiring/recruiter-checklist";
import {
  assessRecruiterReadiness,
  buildRecruiterTurnMessage,
  chooseNextRecruiterQuestion,
  finalizeReadinessScore,
  generateSuggestionChips,
  inferDepartmentId,
  isEngineeringBrief,
} from "@/lib/hiring/recruiter-brain";
import {
  MAYA_EMPLOYEE_NAME,
  MAYA_EMPLOYEE_SYSTEM_PROMPT,
  MAYA_EMPLOYEE_TITLE,
  MAYA_HIRE_LANGUAGE_RULE,
} from "@/lib/hiring/maya";
import { isHiringSmallTalk } from "@/lib/hiring/maya-recruiter-state";
import type {
  AiEmployeeJobBrief,
  RecruiterMessage,
  RecruiterReadiness,
  RecruiterSuggestionChip,
  RefineMode,
} from "@/lib/hiring/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RecruiterBody = {
  conversation?: RecruiterMessage[];
  selectedDepartment?: string | null;
  userMessage?: string;
  action?: "message" | "draft_now" | "refine_section";
  roleSeed: string;
  departmentId?: string | null;
  roleKey?: string | null;
  departmentGroupId?: string | null;
  discoveryMode?: boolean;
  customRoleTitle?: string | null;
  messages: RecruiterMessage[];
  currentBrief?: AiEmployeeJobBrief;
  mode?: "chat" | "regenerate" | "refine" | "draft_now" | "brief_refine";
  refineInstruction?: string;
  refineMode?: RefineMode;
  refineSection?: string;
};

function normalizeBrief(raw: z.infer<typeof briefSchema>): AiEmployeeJobBrief {
  return {
    ...raw,
    technicalFocus: raw.technicalFocus ?? [],
    businessFocus: raw.businessFocus ?? [],
    personalityTraits: raw.personalityTraits ?? [],
    toolsNeeded: raw.toolsNeeded ?? [],
    assumptions: raw.assumptions ?? [],
    openQuestions: raw.openQuestions ?? [],
  };
}

function normalizeBody(body: RecruiterBody) {
  const conversation = body.conversation ?? body.messages ?? [];
  const departmentId = body.selectedDepartment ?? body.departmentId ?? null;
  const roleKey = body.roleKey ?? null;
  const action = body.action ?? (body.mode === "draft_now" ? "draft_now" : "message");
  return { conversation, departmentId, roleKey, action };
}

function applyInstructionToBrief(brief: AiEmployeeJobBrief, instruction: string): AiEmployeeJobBrief {
  const lower = instruction.toLowerCase();
  let next = { ...brief };

  if (lower.includes("senior") || lower.includes("advisor")) {
    next = {
      ...next,
      seniorityLevel: lower.includes("advisor") ? "advisor" : "manager",
      autonomyLevel: "high",
      assumptions: [
        ...new Set([
          ...next.assumptions,
          "The user wants this employee to operate with more senior judgment.",
        ]),
      ],
    };
  }
  if (lower.includes("hands-on") || lower.includes("implementation")) {
    next = {
      ...next,
      autonomyLevel: next.autonomyLevel === "low" ? "balanced" : next.autonomyLevel,
      coreResponsibilities: [
        ...new Set([
          ...next.coreResponsibilities,
          "Work hands-on to turn ideas into clear implementation tasks",
        ]),
      ],
    };
  }
  if (lower.includes("tool")) {
    next = {
      ...next,
      toolsNeeded: [...new Set([...next.toolsNeeded, "Project docs", "Issue tracker", "Relevant workspace tools"])],
    };
  }
  if (lower.includes("approval") || lower.includes("risk")) {
    next = {
      ...next,
      approvalRules: [
        ...new Set([...next.approvalRules, "Ask for approval before high-risk or external-facing actions"]),
      ],
    };
  }

  return next;
}

function recruiterMessageFor(
  readiness: RecruiterReadiness,
  conversation: RecruiterMessage[],
  currentBrief: AiEmployeeJobBrief,
  roleKey?: string | null,
) {
  const lastUser = [...conversation].reverse().find((m) => m.role === "user")?.text.toLowerCase() ?? "";
  if (lastUser.includes("don't know") || lastUser.includes("not sure") || lastUser.includes("help me decide")) {
    const role = getRoleByKey(roleKey ?? undefined);
    if (role?.questionTemplates.coreWorkChips.length) {
      return `No problem. For ${role.title} roles, common starting points are ${role.questionTemplates.coreWorkChips.slice(0, 4).join(", ").toLowerCase()}. Which feels closest?`;
    }
    const deptId = inferDepartmentId(currentBrief);
    if (deptId === "pr") {
      return "No problem. For PR roles, common starting points are press releases, media pitching, internal comms, or crisis response. Which feels closest to what you need?";
    }
    if (deptId === "marketing") {
      return "No problem. For marketing hires, teams often start with content, campaigns, social, or SEO. Which direction fits best?";
    }
    if (deptId === "sales") {
      return "No problem. For sales support, people usually start with lead qualification, outbound outreach, proposals, or pipeline follow-ups. Which sounds right?";
    }
    if (isEngineeringBrief(currentBrief)) {
      return "No problem. For engineering roles, common directions are frontend product work, backend systems, AI infrastructure, or data workflows. Which feels closest?";
    }
    return "No problem. Tell me whether you want someone more strategic, more execution-focused, or a mix — and I'll shape the brief from there.";
  }
  return chooseNextRecruiterQuestion(readiness, currentBrief, roleKey);
}

function useRecruiterLlm(
  body: RecruiterBody,
  conversation: RecruiterMessage[],
  action: string,
): boolean {
  const mode = body.mode ?? "chat";
  if (mode === "refine" || mode === "brief_refine" || mode === "regenerate") return true;
  if (action === "refine_section") return true;
  const lastUser = [...conversation].reverse().find((m) => m.role === "user")?.text ?? "";
  const userTurns = conversation.filter((m) => m.role === "user").length;
  if (userTurns >= 1 && lastUser.trim().length > 2 && !isHiringSmallTalk(lastUser)) return true;
  if (lastUser.length > 220) return true;
  return false;
}

function openingMessage(body: RecruiterBody, departmentId: string | null, roleKey?: string | null) {
  return buildRecruiterOpeningMessage({
    roleSeed: body.roleSeed,
    roleKey,
    departmentId,
  });
}

function buildResponse(input: {
  body: RecruiterBody;
  brief: AiEmployeeJobBrief;
  conversation: RecruiterMessage[];
  message?: string;
  usedFallback: boolean;
  forceCanReview?: boolean;
}) {
  const lastUser = [...input.conversation].reverse().find((m) => m.role === "user")?.text ?? "";
  const chipMutation = lastUser ? applyChipMutation(lastUser, input.brief) : null;
  let brief = chipMutation?.brief ?? input.brief;
  const roleKey = input.body.roleKey ?? null;
  const roleFocus = lastUser ? applyRoleFocusAnswer(lastUser, brief, roleKey) : null;
  if (roleFocus) {
    brief = roleFocus.brief;
  }
  const changedFields = [...(chipMutation?.changedFields ?? []), ...(roleFocus ? ["businessFocus"] : [])];

  const baseReadiness = assessRecruiterReadiness(input.conversation, brief, roleKey);
  const canReviewBrief = input.forceCanReview || baseReadiness.ready;
  const readiness = finalizeReadinessScore(baseReadiness, brief, canReviewBrief);
  let suggestionChips = generateSuggestionChips(readiness, brief, input.conversation, roleKey);
  if (canReviewBrief && !suggestionChips.some((chip) => chip.intent === "review_brief")) {
    suggestionChips = [
      {
        id: "review-brief",
        label: "Review job brief",
        value: "Review job brief",
        intent: "review_brief",
      },
      ...suggestionChips,
    ];
  }
  const userTurns = input.conversation.filter((m) => m.role === "user").length;
  const departmentId = input.body.selectedDepartment ?? input.body.departmentId ?? null;
  const lastAde = [...input.conversation].reverse().find((m) => m.role === "ade")?.text ?? "";

  let message = input.message;
  if (!message && chipMutation) {
    message = chipMutation.message;
  } else if (!message) {
    if (userTurns === 0) {
      message = openingMessage(input.body, departmentId, roleKey);
    } else if (canReviewBrief && lastAde.includes(READY_BRIEF_PHRASE)) {
      message =
        "That's already reflected in the brief. Want me to generate candidates or adjust another part?";
    } else if (canReviewBrief) {
      message = recruiterReadyMessage(brief);
    } else {
      message = buildRecruiterTurnMessage(readiness, input.conversation, brief, roleKey);
    }
  }

  const checklist = checklistFromBrief(brief, input.body.roleSeed, input.conversation);

  return {
    recruiterMessage: message,
    message,
    brief,
    briefPartial: brief,
    readiness,
    suggestionChips,
    canReviewBrief,
    briefReady: canReviewBrief,
    chips: suggestionChips.map((chip) => chip.label),
    checklist,
    usedFallback: input.usedFallback,
    roleKey,
    changedFields,
  };
}

function systemPrompt(body: RecruiterBody) {
  const departmentId = body.selectedDepartment ?? body.departmentId ?? null;
  const role = getRoleByKey(body.roleKey ?? undefined);
  const roleBlock = role
    ? `Selected role: ${role.title} (${role.roleKey})
Department group: ${role.departmentLabel}
Default responsibilities: ${role.defaultResponsibilities.slice(0, 4).join("; ")}
Ask role-specific follow-ups. Do not ask generic department questions.`
    : "";
  return `You are ${MAYA_EMPLOYEE_NAME}, ${MAYA_EMPLOYEE_TITLE} at AdeHQ — a sharp, warm recruiter who talks like a real hiring partner, not a survey bot.

${MAYA_EMPLOYEE_SYSTEM_PROMPT.trim()}

Role seed: "${body.roleSeed || "unspecified"}"
Department: ${departmentLabel(departmentId)}
${roleBlock}

RULES:
1. Sound like a colleague in chat — short sentences, natural rhythm, no corporate filler.
2. Always acknowledge what the user just said before asking anything new.
3. NEVER repeat a question the user already answered. Move the conversation forward.
4. Extract semantics from ALL user messages — NEVER map answers by question order.
5. Ask at most ONE useful question per turn.
6. If enough information exists, say the brief is ready but keep the user free to refine.
7. Always include an updated semantic brief or partial brief.
8. Never ask about channels, rooms, or start location.
9. ${MAYA_HIRE_LANGUAGE_RULE}

Mode: ${body.mode ?? "chat"}
${body.refineInstruction ? `Refine (${body.refineMode ?? "improve"}) section ${body.refineSection}: ${body.refineInstruction}` : ""}

Respond ONLY as JSON matching the schema.`;
}

export async function POST(request: NextRequest) {
  try {
    await requireAuthUser(request);
    const body = (await request.json()) as RecruiterBody;

    const { conversation, departmentId, roleKey, action } = normalizeBody(body);

    if (!body.roleSeed?.trim() && !departmentId && !roleKey) {
      return NextResponse.json({ error: "roleSeed, roleKey, or departmentId required." }, { status: 400 });
    }

    const baseBrief = synthesizeBriefForHiringContext({
      roleSeed: body.roleSeed,
      messages: conversation,
      departmentId,
      roleKey,
      existing: body.currentBrief,
    });

    const instruction = [...conversation].reverse().find((m) => m.role === "user")?.text ?? "";
    const refinedBrief =
      body.currentBrief && (body.mode === "brief_refine" || action === "refine_section")
        ? applyInstructionToBrief(baseBrief, instruction)
        : baseBrief;

    if (!useRecruiterLlm(body, conversation, action)) {
      return NextResponse.json(
        buildResponse({
          body,
          brief: refinedBrief,
          conversation,
          message:
            action === "draft_now"
              ? "I have enough to draft a strong job brief. You can review it now, or keep refining the role."
              : undefined,
          usedFallback: true,
          forceCanReview: action === "draft_now",
        }),
      );
    }

    if (!isSiliconFlowConfigured()) {
      const brief = refinedBrief;
      return NextResponse.json(
        buildResponse({
          body,
          brief,
          conversation,
          message:
            action === "draft_now"
              ? "I have enough to draft a strong job brief. You can review it now, or keep refining the role."
              : undefined,
          usedFallback: true,
          forceCanReview: action === "draft_now",
        }),
      );
    }

    const modelId = resolveModel("siliconflow", "cheap");
    const model = siliconFlowChatModel(modelId);
    const history = conversation
      .map((m) => `${m.role === "ade" ? "Ade" : "User"}: ${m.text}`)
      .join("\n");

    try {
      const { object } = await generateObject({
        model,
        schema: recruiterResponseSchema,
        system: systemPrompt(body),
        prompt: [
          `Conversation:\n${history || "(starting)"}`,
          body.currentBrief ? `Current brief:\n${JSON.stringify(body.currentBrief)}` : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
        maxOutputTokens: 1400,
        providerOptions: siliconFlowProviderOptions(modelId),
      });

      let brief = object.brief ? normalizeBrief(object.brief) : undefined;
      const briefPartial = object.briefPartial
        ? mergeBriefPartial(
            baseBrief,
            object.briefPartial,
          )
        : brief;

      brief = brief ?? briefPartial ?? baseBrief;
      if (body.currentBrief && (body.mode === "brief_refine" || action === "refine_section")) {
        const instruction = [...conversation].reverse().find((m) => m.role === "user")?.text ?? "";
        brief = applyInstructionToBrief(brief, instruction);
      }

      return NextResponse.json(
        buildResponse({
          body,
          brief,
          conversation,
          message: object.message,
          usedFallback: false,
          forceCanReview: action === "draft_now",
        }),
      );
    } catch {
      return NextResponse.json(
        buildResponse({
          body,
          brief: baseBrief,
          conversation,
          usedFallback: true,
        }),
      );
    }
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[hiring/recruiter]", err);
    return NextResponse.json({ error: "Recruiter request failed." }, { status: 500 });
  }
}
